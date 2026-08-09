import { mapWithConcurrency } from './gemini';
import { AiError } from './ai';
import { pcmDuration, pcmToWav } from './audio/wav';
import { createNote, saveMindmap, updateJob } from './db';
import {
  HOSTS,
  MINDMAP_SCHEMA,
  STUDIO_TASKS,
  type StudioTaskKey,
  mindmapPrompt,
  podcastScriptPrompt,
  studioSystem,
  ttsInstruction,
} from './prompts';
import { buildContextBlock, readAll, type RagContext } from './rag';
import type { Mindmap, Note, Source } from './types';

const SAMPLE_RATE = 24_000;

/**
 * Таван на сценария в токени.
 *
 * Върви с исканата дължина, защото изходните токени се генерират серийно —
 * таванът е и таван на времето, а цялата задача живее в едно изпълнение на
 * worker-а. Но не бива да е стегнат: при моделите от 2.5 нагоре токените за
 * мислене се броят в същия таван, тоест 1500 стигат моделът да „помисли“ и да
 * върне празен текст. Оттам идваше „Сценарият излезе твърде кратък“.
 *
 * Двуминутен сценарий е ~300 думи (под 1000 токена изход), а останалото е
 * запас за мисленето.
 */
export function scriptTokenBudget(minutes: number): number {
  return Math.min(12_000, Math.max(6000, Math.round(minutes * 1200)));
}

/* ── Учебни материали ────────────────────────────────────────────────────── */

export async function generateStudioNote(
  ctx: RagContext,
  notebookId: string,
  sources: Source[],
  task: StudioTaskKey,
): Promise<Note> {
  const passages = await readAll(ctx, sources, 90_000);
  if (passages.length === 0) {
    throw new AiError(400, 'Няма обработени източници, от които да направя материала.');
  }

  const spec = STUDIO_TASKS[task];
  const body = await ctx.ai.chat.generateText({
    prompt: `Пасажи от източниците:\n\n${buildContextBlock(passages)}\n\n---\n\n${spec.prompt}`,
    systemInstruction: studioSystem(ctx.language),
    config: { temperature: 0.4, maxOutputTokens: 8192 },
  });

  return createNote(ctx.db, notebookId, { kind: task, title: spec.title, body });
}

/* ── Мисловна карта ──────────────────────────────────────────────────────── */

export async function generateMindmap(
  ctx: RagContext,
  notebookId: string,
  sources: Source[],
): Promise<Mindmap> {
  const passages = await readAll(ctx, sources, 60_000);
  if (passages.length === 0) {
    throw new AiError(400, 'Няма обработени източници за мисловна карта.');
  }

  const map = await ctx.ai.chat.generateJson<Mindmap>({
    prompt: `Пасажи от източниците:\n\n${buildContextBlock(passages)}\n\n---\n\n${mindmapPrompt(ctx.language)}`,
    schema: MINDMAP_SCHEMA,
  });

  const clean: Mindmap = {
    center: (map.center ?? 'Тема').trim(),
    nodes: (map.nodes ?? [])
      .filter((n) => n?.label?.trim())
      .slice(0, 6)
      .map((n) => ({ label: n.label.trim(), hint: n.hint?.trim() })),
  };
  await saveMindmap(ctx.db, notebookId, clean);
  return clean;
}

/* ── Аудио преглед ───────────────────────────────────────────────────────── */

export interface AudioResult {
  r2Key: string;
  durationS: number;
  script: string;
}

/**
 * Прави подкаст с двама водещи: сценарий от източниците → реплики →
 * multi-speaker TTS на сегменти → един WAV файл в R2.
 *
 * Тече във фонов режим (`ctx.waitUntil`) и обновява реда в studio_jobs, защото
 * отнема десетки секунди. Прегледът е кратък нарочно — виж `audioMinutes` в
 * plans.ts за двете причини.
 */
export async function generateAudioOverview(
  ctx: RagContext,
  input: {
    jobId: string;
    notebookId: string;
    sources: Source[];
    files: R2Bucket;
    minutes?: number;
  },
): Promise<AudioResult> {
  // Долната граница е 1: планът вече дава по 2 минути, а стар клиент може да
  // поиска повече — таванът е на плана, не тук.
  const minutes = clamp(input.minutes ?? 2, 1, 12);

  await updateJob(ctx.db, input.jobId, {
    status: 'running',
    step: 'Чета източниците…',
    progress: 5,
  });

  const passages = await readAll(ctx, input.sources, 90_000);
  if (passages.length === 0) {
    throw new AiError(400, 'Няма обработени източници за аудио преглед.');
  }

  await updateJob(ctx.db, input.jobId, { step: 'Пиша сценария…', progress: 15 });

  const script = await ctx.ai.chat.generateText({
    prompt: `Пасажи от източниците:\n\n${buildContextBlock(passages)}\n\n---\n\n${podcastScriptPrompt(
      ctx.language,
      minutes,
    )}`,
    config: { temperature: 0.85, maxOutputTokens: scriptTokenBudget(minutes) },
  });

  const turns = parseTurns(script);
  if (turns.length < 4) {
    // „Твърде кратък“ не казва нищо на никого. Трите случая се различават и
    // искат различно действие, затова се различават и в текста.
    console.error('[zapiski:studio] сценарият не се разчете', {
      chars: script.length,
      turns: turns.length,
      budget: scriptTokenBudget(minutes),
      script: script.slice(0, 600),
    });
    throw new AiError(502, describeShortScript(script, turns.length));
  }

  const segments = groupTurns(turns);
  await updateJob(ctx.db, input.jobId, {
    step: `Озвучавам (0 от ${segments.length})…`,
    progress: 25,
  });

  const speakers = [
    { name: HOSTS.a.name, voice: HOSTS.a.voice },
    { name: HOSTS.b.name, voice: HOSTS.b.voice },
  ];

  // Пишем директно в един буфер, вместо да пазим всички сегменти наведнъж:
  // две минути звук са ~5.8 MB, а Workers има 128 MB памет за всичко.
  const writer = new PcmWriter(minutes * 60 * SAMPLE_RATE * 2 * 1.5);
  let done = 0;

  const rendered = await mapWithConcurrency(segments, 2, async (segment) => {
    const part = await ctx.ai.tts.speak({
      text: `${ttsInstruction()}\n\n${segment}`,
      speakers,
    });
    done++;
    // Прогресът се обновява „в движение“; редът на записа се пази отдолу.
    await updateJob(ctx.db, input.jobId, {
      step: `Озвучавам (${done} от ${segments.length})…`,
      progress: 25 + Math.round((done / segments.length) * 60),
    });
    return part;
  });

  for (const part of rendered) writer.push(part.pcm);

  // Честотата идва от самия модел, а не от константа: сгрешена в заглавката на
  // WAV-а, тя пуска записа по-бързо или по-бавно, без нищо да гръмне. Различни
  // честоти между сегментите не се смесват — това вече е чужд глас в средата.
  const rate = rendered[0]?.sampleRate ?? SAMPLE_RATE;
  const odd = rendered.find((p) => p.sampleRate !== rate);
  if (odd) {
    throw new AiError(
      502,
      `Моделът върна различни честоти (${rate} и ${odd.sampleRate} Hz) за един и същ подкаст.`,
    );
  }

  const pcm = writer.done();
  const durationS = pcmDuration(pcm.length, rate);
  const wav = pcmToWav(pcm, { sampleRate: rate });

  await updateJob(ctx.db, input.jobId, { step: 'Записвам файла…', progress: 92 });

  const r2Key = `audio/${input.notebookId}/${input.jobId}.wav`;
  await input.files.put(r2Key, wav as unknown as ArrayBuffer, {
    httpMetadata: { contentType: 'audio/wav', cacheControl: 'private, max-age=31536000' },
  });

  await updateJob(ctx.db, input.jobId, {
    status: 'done',
    step: 'Готово',
    progress: 100,
    r2Key,
    durationS,
    resultJson: JSON.stringify({ script, durationS, segments: segments.length }),
  });

  return { r2Key, durationS, script };
}

/**
 * Защо сценарият не става за озвучаване. Изнесено, защото трите случая водят до
 * различни неща: празен отговор е таван или отказ на модела, а неразчетен —
 * формат, който `parseTurns` не познава.
 */
function describeShortScript(script: string, turns: number): string {
  const clean = script.trim();
  if (clean.length === 0) {
    return 'Моделът не върна сценарий. Най-често значи, че целият таван за изхода е отишъл в „мислене“ — вдигни maxOutputTokens в scriptTokenBudget или пробвай друг CHAT_MODEL.';
  }
  if (turns === 0) {
    return `Моделът върна ${clean.length} знака, но нито един ред във формата „${HOSTS.a.name}: …“. Пробвай пак; ако се повтаря, моделът не спазва формата и трябва друг CHAT_MODEL.`;
  }
  return `Сценарият излезе само ${turns} реплики (${clean.length} знака) — твърде кратък за преглед. Опитай пак.`;
}

/* ── Сценарий → сегменти за TTS ──────────────────────────────────────────── */

export interface Turn {
  speaker: string;
  text: string;
}

export function parseTurns(script: string): Turn[] {
  const names = [HOSTS.a.name, HOSTS.b.name];
  const turns: Turn[] = [];

  for (const rawLine of script.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // Пропускаме заглавия и режисьорски указания, ако моделът е добавил такива.
    if (/^(#|\*\*[^:]*\*\*$|\[|\()/.test(line) && !/^\*\*(Ния|Стефан)/.test(line)) continue;

    const m = /^\*{0,2}([^:*]{1,24})\*{0,2}\s*:\s*(.+)$/.exec(line);
    if (m) {
      const speaker = names.find((n) => m[1]!.trim().startsWith(n));
      if (speaker) {
        turns.push({ speaker, text: cleanLine(m[2]!) });
        continue;
      }
    }
    // Продължение на предишната реплика.
    const last = turns[turns.length - 1];
    if (last) last.text += ` ${cleanLine(line)}`;
  }

  return turns.filter((t) => t.text.length > 0);
}

function cleanLine(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/^[-—•]\s*/, '')
    .replace(/\((?:смее се|пауза|смях)[^)]*\)/gi, '')
    .trim();
}

/**
 * Групира репликите в парчета, които TTS-ът поема наведнъж.
 * Всяко парче съдържа и двамата водещи, за да работи multi-speaker гласът.
 */
export function groupTurns(turns: Turn[], maxChars = 1400): string[] {
  const out: string[] = [];
  let buf: Turn[] = [];
  let len = 0;

  const flush = () => {
    if (buf.length === 0) return;
    out.push(buf.map((t) => `${t.speaker}: ${t.text}`).join('\n'));
    buf = [];
    len = 0;
  };

  for (const t of turns) {
    const size = t.speaker.length + t.text.length + 2;
    if (len + size > maxChars && buf.length > 0) flush();
    buf.push(t);
    len += size;
  }
  flush();
  return out;
}

/** Буфер с растяща вместимост, за да не държим сегментите два пъти в паметта. */
class PcmWriter {
  #buf: Uint8Array;
  #len = 0;

  constructor(capacity: number) {
    this.#buf = new Uint8Array(Math.max(1024, Math.ceil(capacity)));
  }

  push(bytes: Uint8Array): void {
    if (this.#len + bytes.length > this.#buf.length) {
      const grown = new Uint8Array(Math.ceil((this.#len + bytes.length) * 1.3));
      grown.set(this.#buf.subarray(0, this.#len));
      this.#buf = grown;
    }
    this.#buf.set(bytes, this.#len);
    this.#len += bytes.length;
  }

  done(): Uint8Array {
    return this.#buf.subarray(0, this.#len);
  }
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}
