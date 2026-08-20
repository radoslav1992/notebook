/**
 * Единственото място, което говори с Cloudflare Workers AI.
 *
 * Два вида модели минават през едно и също `env.AI.run`, но с различни тела:
 *
 *   • `google/*`  — партньорските Gemini модели приемат тялото на Google
 *     (`contents`, `generationConfig`, `speechConfig`). Затова и подкастът с
 *     двама водещи на български работи: `google/gemini-3.1-flash-tts` е същият
 *     модел, само сметката е на Cloudflare и не иска ключ от Google.
 *   • `@cf/*`     — собствените модели на Cloudflare имат своя форма
 *     (`messages` за текст, `text` за вграждания).
 *
 * Какво Cloudflare НЕ може и се пази от Google: YouTube по линк, вграден
 * аудио файл и File Search. Тези пътища искат `ai.google` и казват го ясно.
 */

import { AiError, withTimeout } from './error';
import { bodyShapeFor, usesGeminiShape } from './select';
import type {
  ChatModel,
  Content,
  EmbedModel,
  EmbedTask,
  GenerateConfig,
  Speaker,
  SpeechModel,
} from './types';

/** Само това ни трябва от binding-а; типът на `Ai` в workers-types изброява модели. */
export interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

/**
 * Поддържа ли даден модел стрийминг. Проверява се веднъж на модел, при първата
 * заявка: ако `stream: true` бъде отхвърлено, повече не се пробва.
 */
const STREAMS = new Map<string, boolean>();

/**
 * Приема ли даден `openai/*` модел допълненията към тялото — `reasoning` и
 * `temperature`. Проверява се веднъж на модел, при първата заявка.
 *
 * Нужно е, защото документираният пример носи само `input`, `instructions` и
 * `max_output_tokens`, а моделите от рода „reasoning“ често отказват
 * `temperature`. Отказът идва като „User Input Error“ — тоест като грешка в
 * съдържанието, макар да е в настройка. Затова при отказ се пробва още веднъж
 * без тях, вместо въпросът да се проваля.
 */
const RESPONSES_EXTRAS = new Map<string, boolean>();

export class CloudflareAi implements ChatModel, EmbedModel, SpeechModel {
  readonly model: string;
  readonly dimensions: number;
  #ai: AiBinding;

  constructor(opts: { ai: AiBinding; model: string; dimensions?: number }) {
    if (!opts.ai) {
      throw new AiError(
        500,
        'Липсва Workers AI binding. Добави "ai": { "binding": "AI" } в wrangler.jsonc.',
      );
    }
    this.#ai = opts.ai;
    this.model = opts.model;
    this.dimensions = opts.dimensions ?? 1024;
  }

  /* ── низово ниво ───────────────────────────────────────────────────────── */

  async #run(model: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      return await withTimeout(this.#ai.run(model, input), `Workers AI (${model})`);
    } catch (err) {
      throw asAiError(err, model);
    }
  }

  /**
   * Заявка за текст, с едно повторение без допълненията при отказ.
   *
   * Само за `openai/*` и само веднъж на модел: `reasoning` и `temperature` са
   * настройки, не съдържание, тоест по-добре въпросът да мине без тях, отколкото
   * да се провали заради тях. Отказ от 500 нагоре не се повтаря — той не е за
   * тялото.
   */
  async #runText(
    model: string,
    contents: Content[],
    systemInstruction?: string,
    config?: GenerateConfig,
    overrides: Record<string, unknown> = {},
  ): Promise<unknown> {
    const shape = bodyShapeFor(model);
    const canRetry = shape === 'responses' && RESPONSES_EXTRAS.get(model) !== false;
    const build = (extras: boolean) => ({
      ...textBody(model, contents, systemInstruction, config, extras),
      ...overrides,
    });

    try {
      return await this.#run(model, build(canRetry));
    } catch (err) {
      if (!canRetry) throw err;
      if (!(err instanceof AiError) || err.status >= 500) throw err;
      console.warn('[zapiski:ai] Responses API отказа допълненията, пробвам без тях', {
        model,
        detail: err.message.slice(0, 160),
      });
      RESPONSES_EXTRAS.set(model, false);
      return this.#run(model, build(false));
    }
  }

  /* ── текст ─────────────────────────────────────────────────────────────── */

  async generateText(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    config?: GenerateConfig;
  }): Promise<string> {
    const model = input.model ?? this.model;
    const res = await this.#runText(
      model,
      [{ role: 'user', parts: [{ text: input.prompt }] }],
      input.systemInstruction,
      input.config,
    );
    return textFrom(res).trim();
  }

  async generateJson<T>(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    schema: unknown;
  }): Promise<T> {
    const model = input.model ?? this.model;
    const config: GenerateConfig = {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseSchema: input.schema,
    };
    const res = await this.#runText(
      model,
      [{ role: 'user', parts: [{ text: input.prompt }] }],
      input.systemInstruction,
      config,
    );
    const raw = textFrom(res).trim();
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Моделите обичат да обграждат JSON-а с ```json … ``` или с обяснение.
      const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) {
        try {
          return JSON.parse(m[0]) as T;
        } catch {
          /* пада надолу */
        }
      }
      throw new AiError(502, 'Моделът върна невалиден JSON.', raw.slice(0, 400));
    }
  }

  async *stream(input: {
    model?: string;
    contents: Content[];
    systemInstruction?: string;
    config?: GenerateConfig;
  }): AsyncGenerator<{ text: string }> {
    const model = input.model ?? this.model;

    if (STREAMS.get(model) !== false) {
      try {
        const res = await this.#runText(model, input.contents, input.systemInstruction, input.config, {
          stream: true,
        });
        if (res instanceof ReadableStream) {
          STREAMS.set(model, true);
          yield* readSse(res);
          return;
        }
        // Прие „stream“, но върна цял отговор — приемаме го и не пробваме пак.
        STREAMS.set(model, false);
        yield { text: textFrom(res).trim() };
        return;
      } catch (err) {
        if (!(err instanceof AiError) || err.status >= 500) throw err;
        // Отказан заради „stream“ — оттук насетне този модел се пита наведнъж.
        STREAMS.set(model, false);
      }
    }

    const res = await this.#runText(model, input.contents, input.systemInstruction, input.config);
    yield { text: textFrom(res).trim() };
  }

  /* ── вграждания ────────────────────────────────────────────────────────── */

  async embed(texts: string[], _task: EmbedTask = 'RETRIEVAL_DOCUMENT'): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (usesGeminiShape(this.model)) {
      throw new AiError(
        400,
        `Моделът ${this.model} не прави вграждания през Workers AI. Задай EMBED_MODEL на "@cf/baai/bge-m3" (многоезичен, 1024 измерения) или на "gemini-embedding-001" с ключ от Google.`,
      );
    }

    // Партиди: един `run` поема ограничен брой текста, а източник от 200
    // страници дава стотици пасажи.
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 100) {
      const batch = texts.slice(i, i + 100).map((t) => t.slice(0, 8000));
      const res = (await this.#run(this.model, { text: batch })) as {
        data?: number[][];
        shape?: number[];
      };
      const vectors = res?.data ?? [];
      if (vectors.length !== batch.length) {
        throw new AiError(
          502,
          `Моделът върна ${vectors.length} вектора за ${batch.length} пасажа.`,
          res,
        );
      }
      for (const v of vectors) out.push(normalize(v));
    }
    return out;
  }

  /* ── реч ───────────────────────────────────────────────────────────────── */

  async speak(input: { text: string; speakers?: Speaker[]; voice?: string }): Promise<{
    pcm: Uint8Array;
    sampleRate: number;
  }> {
    if (!usesGeminiShape(this.model)) {
      // MeloTTS говори английски, испански, френски, китайски, японски и
      // корейски; Deepgram Aura — английски и испански. Български няма в нито
      // един, а и връщат MP3, докато подкастът се сглобява от сурово PCM.
      throw new AiError(
        400,
        `Моделът ${this.model} не става за аудио преглед на български. Задай TTS_MODEL на "google/gemini-3.1-flash-tts" (през Cloudflare, с двама водещи) или на "gemini-3.1-flash-tts-preview" с ключ от Google.`,
      );
    }

    const res = await this.#run(this.model, {
      contents: [{ role: 'user', parts: [{ text: input.text }] }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: speechConfigFor(input),
      },
    });

    const part = partsFrom(res).find((p) => p.inlineData);
    const data = part?.inlineData?.data;
    if (!data) {
      throw new AiError(502, 'Моделът не върна аудио.', res);
    }
    return {
      pcm: base64ToBytes(data),
      sampleRate: sampleRateFromMime(part!.inlineData!.mimeType),
    };
  }
}

/* ── Тела на заявките ────────────────────────────────────────────────────── */

/**
 * Едно и също съдържание в двете форми: Gemini за `google/*`, `messages` за
 * `@cf/*`. Системната инструкция е отделно поле при Google и роля `system` при
 * Cloudflare.
 */
/**
 * Колко да мисли моделът от рода „reasoning“.
 *
 * Токените за мислене се таксуват като изход и не се виждат в отговора, тоест
 * неограничено мислене е неограничена сметка за нещо, което потребителят не чете.
 * Задачата тук е преразказ на подадени пасажи с цитати — тя не иска дълго
 * обмисляне, иска вярност към текста.
 */
const REASONING_EFFORT = 'low';

function textBody(
  model: string,
  contents: Content[],
  systemInstruction?: string,
  config?: GenerateConfig,
  extras = true,
): Record<string, unknown> {
  const shape = bodyShapeFor(model);

  if (shape === 'responses') {
    return {
      // Низ, не масив от съобщения: така е в документирания пример, а масив дава
      // „User Input Error“. При разговор репликите се сливат с етикети — губи се
      // структурата, но печели това, че заявката минава.
      input: flatten(contents),
      ...(systemInstruction ? { instructions: systemInstruction } : {}),
      ...(config?.maxOutputTokens === undefined
        ? {}
        : { max_output_tokens: config.maxOutputTokens }),
      ...(extras
        ? {
            reasoning: { effort: REASONING_EFFORT },
            ...(config?.temperature === undefined ? {} : { temperature: config.temperature }),
          }
        : {}),
      ...(config?.responseSchema
        ? {
            text: {
              format: {
                type: 'json_schema',
                name: 'answer',
                schema: config.responseSchema,
              },
            },
          }
        : {}),
    };
  }

  if (shape === 'gemini') {
    return {
      contents,
      ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
      generationConfig: config ?? {},
    };
  }

  const messages = [
    ...(systemInstruction ? [{ role: 'system', content: systemInstruction }] : []),
    ...contents.map((c) => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts.map((p) => p.text ?? '').join(''),
    })),
  ];

  return {
    messages,
    ...(config?.temperature === undefined ? {} : { temperature: config.temperature }),
    ...(config?.maxOutputTokens === undefined ? {} : { max_tokens: config.maxOutputTokens }),
    ...(config?.responseSchema
      ? { response_format: { type: 'json_schema', json_schema: config.responseSchema } }
      : {}),
  };
}

function speechConfigFor(input: { speakers?: Speaker[]; voice?: string }): Record<string, unknown> {
  if (input.speakers && input.speakers.length > 1) {
    return {
      multiSpeakerVoiceConfig: {
        speakerVoiceConfigs: input.speakers.slice(0, 2).map((s) => ({
          speaker: s.name,
          voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
        })),
      },
    };
  }
  return {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: input.voice ?? input.speakers?.[0]?.voice ?? 'Kore' },
    },
  };
}

/* ── Четене на отговорите ────────────────────────────────────────────────── */

interface GeminiShaped {
  candidates?: { content?: { parts?: { text?: string; inlineData?: { mimeType?: string; data?: string } }[] } }[];
  promptFeedback?: { blockReason?: string };
}

function partsFrom(res: unknown): { text?: string; inlineData?: { mimeType?: string; data?: string } }[] {
  return (res as GeminiShaped)?.candidates?.[0]?.content?.parts ?? [];
}

/**
 * Текстът от отговор в едната или другата форма — без подрязване.
 *
 * Парчетата от поток НЕ бива да се подрязват: „…падат “ и „ с 55%“ се слепват в
 * „…падатс 55%“, ако всяко си изгуби празното място. Завършените отговори се
 * подрязват при извикващия.
 */
function textFrom(res: unknown): string {
  if (typeof res === 'string') return res;
  const parts = partsFrom(res);
  if (parts.length) return parts.map((p) => p.text ?? '').join('');
  const fromResponses = responsesText(res);
  if (fromResponses !== null) return fromResponses;

  const own = res as { response?: unknown; result?: { response?: unknown } };
  const text = own?.response ?? own?.result?.response;
  return typeof text === 'string' ? text : '';
}

/**
 * Текстът от отговор на Responses API (`openai/*`).
 *
 * `output` е списък и първите му елементи може да са от вида `reasoning` — те са
 * без текст за четене. Затова се търсят само `output_text` парчетата, вместо да
 * се взима „първият елемент“: иначе отговорът излиза празен точно при моделите,
 * които мислят, а това после се чете като „моделът не върна нищо“.
 *
 * Връща `null`, ако формата изобщо не е тази, за да продължи търсенето по
 * останалите пътища.
 */
function responsesText(res: unknown): string | null {
  const r = res as {
    output_text?: unknown;
    output?: { type?: string; content?: { type?: string; text?: unknown }[] }[];
    delta?: unknown;
  };

  // Стрийминг: всяко събитие носи парченце в `delta`.
  if (typeof r?.delta === 'string') return r.delta;
  if (typeof r?.output_text === 'string') return r.output_text;

  if (Array.isArray(r?.output)) {
    const text = r.output
      .flatMap((item) => item?.content ?? [])
      .filter((part) => part?.type === 'output_text' || typeof part?.text === 'string')
      .map((part) => (typeof part.text === 'string' ? part.text : ''))
      .join('');

    // Формата е позната, но текст няма. Или моделът е мислил и е свършил тавана,
    // или полетата не са тези, които чакаме. Вторият случай е тих и много скъп за
    // намиране, затова се вижда в лога с ВИДОВЕТЕ на елементите — без текста им,
    // защото това е съдържание на потребителя.
    if (!text) {
      console.warn('[zapiski:ai] Responses API без текст', {
        items: r.output.map((item) => item?.type ?? '?'),
        parts: r.output.flatMap((item) => (item?.content ?? []).map((c) => c?.type ?? '?')),
      });
    }
    return text;
  }

  return null;
}

/**
 * Разговорът като един низ — за формата, която иска `input` низ.
 *
 * Един ред без етикет, когато има само един въпрос: етикетът „Потребител:“ пред
 * самотен въпрос е шум, който моделът понякога приема за част от задачата.
 */
function flatten(contents: Content[]): string {
  const turns = contents.map((c) => ({
    role: c.role === 'model' ? 'Асистент' : 'Потребител',
    text: c.parts.map((p) => p.text ?? '').join(''),
  }));
  if (turns.length === 1) return turns[0]!.text;
  return turns.map((t) => `${t.role}: ${t.text}`).join('\n\n');
}

/** SSE от Workers AI: `data: {...}` на всеки ред, в двете възможни форми. */
async function* readSse(stream: ReadableStream): AsyncGenerator<{ text: string }> {
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;
    let nl: number;
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        continue;
      }
      const text = textFrom(parsed);
      if (text) yield { text };
    }
  }
}

/**
 * Грешките от binding-а идват като обикновени Error с текст от Cloudflare.
 * Изваждаме статуса, ако го има, за да може нагоре да се различи „няма достъп“
 * от „моделът се задави“.
 */
function asAiError(err: unknown, model: string): AiError {
  if (err instanceof AiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  const code = /\b(\d{3})\b/.exec(message)?.[1];
  const status = code ? Number(code) : 502;
  const lower = message.toLowerCase();

  /**
   * 7003 е грешка за МАРШРУТИЗИРАНЕ при Cloudflare: „не мога да стигна до този
   * обект“. При `env.AI.run` това на практика значи, че адресът на модела не се
   * разпознава — сгрешено име, или име, до което този акаунт няма достъп.
   *
   * Стои преди проверката за „no such model“, защото текстът ѝ е друг („User
   * Input Error“) и иначе случаят падаше в общото съобщение, без да каже КОЙ
   * модел е отказан.
   */
  if (message.includes('7003')) {
    return new AiError(
      404,
      `Cloudflare не намери модел „${model}“. Кодът 7003 значи, че адресът на модела не се разпознава — най-често сгрешено име или модел, до който акаунтът няма достъп. Сравни го със списъка в Workers AI → Models, а какво е зададено в момента виж на /api/models.`,
      message,
    );
  }

  if (lower.includes('no such model') || lower.includes('model not found')) {
    return new AiError(
      404,
      `Cloudflare не познава модела ${model}. Провери името в Workers AI → Models.`,
      message,
    );
  }
  if (lower.includes('unauthorized') || lower.includes('forbidden') || status === 401 || status === 403) {
    return new AiError(
      status === 403 ? 403 : 401,
      'Cloudflare отказа заявката към Workers AI. Провери дали планът включва модела.',
      message,
      true,
    );
  }
  if (lower.includes('capacity') || lower.includes('rate limit') || status === 429) {
    return new AiError(429, 'Workers AI е претоварен в момента. Опитай пак след малко.', message);
  }
  // Името на модела и формата на тялото влизат в текста: грешка за модел, която
  // не казва кой е моделът, оставя човека да гадае между три роли (чат,
  // вграждания, реч) и три различни форми на заявката.
  return new AiError(
    status,
    `Workers AI отказа заявката за „${model}“ (форма: ${bodyShapeFor(model)}): ${message}`.slice(0, 300),
    message,
  );
}

/* ── Дребни помощни ──────────────────────────────────────────────────────── */

function normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const len = Math.sqrt(sum);
  return len > 0 ? values.map((v) => v / len) : values;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** „audio/L16;codec=pcm;rate=24000“ → 24000 */
function sampleRateFromMime(mime: string | undefined): number {
  const m = /rate=(\d+)/.exec(mime ?? '');
  return m ? Number(m[1]) : 24_000;
}
