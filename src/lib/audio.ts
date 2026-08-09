import * as db from './db';
import type { AppContext } from './env';
import { generateText, synthesizeSpeech, type SpeakerVoice } from './gemini';
import { fileSearchTool, scopeToSelection } from './rag';
import type { AudioFormat } from './types';

const SAMPLE_RATE = 24_000;
const BYTES_PER_SAMPLE = 2; // 16-bit mono

/** Each TTS call handles roughly a minute of dialogue; we split on speaker turns. */
const CHARS_PER_CHUNK = 2_400;

export interface AudioStyle {
  label: string;
  speakers: SpeakerVoice[];
  scriptPrompt: (focus: string | null) => string;
}

const HOST_A = 'Alex';
const HOST_B = 'Jordan';

function focusLine(focus: string | null): string {
  return focus?.trim()
    ? `\n\nThe listener asked you to focus on: ${focus.trim()}. Build the episode around that, and only cover other material where it supports that focus.`
    : '';
}

const DIALOGUE_RULES = `Hard rules:
- Every line must begin with "${HOST_A}:" or "${HOST_B}:" and nothing else. No stage directions, no markdown, no sound-effect notes, no headings.
- Ground everything in the retrieved sources. If the sources do not say it, it does not go in the script.
- Write how people actually talk: contractions, short sentences, the occasional interruption or "wait, back up". Avoid essay prose read aloud.
- Never say "the sources", "the documents", or "the uploaded material". Refer to the subject directly.
- Open cold, straight into the substance. No "welcome back to the podcast".
- Close on the single idea that matters most, not a recap of everything.`;

export const AUDIO_STYLES: Record<AudioFormat, AudioStyle> = {
  deep_dive: {
    label: 'Deep dive',
    speakers: [
      { speaker: HOST_A, voiceName: 'Kore' },
      { speaker: HOST_B, voiceName: 'Puck' },
    ],
    scriptPrompt: (focus) => `Write a two-host audio deep dive about the sources. Target 900-1300 words — roughly six to eight minutes of speech.

${HOST_A} drives the conversation and frames each idea. ${HOST_B} pushes on the interesting parts, brings the concrete examples and numbers, and pulls things back to why a listener should care.

Move through three or four substantial ideas. For each one: state it, ground it in a specific detail from the sources, then say what follows from it.${focusLine(focus)}

${DIALOGUE_RULES}`,
  },

  brief: {
    label: 'Brief',
    speakers: [{ speaker: HOST_A, voiceName: 'Kore' }],
    scriptPrompt: (focus) => `Write a single-narrator audio brief on the sources. Target 300-400 words — about two minutes.

Lead with the most important finding in the first sentence. Then the two or three things that support it. Then what is still unresolved.${focusLine(focus)}

Hard rules:
- Every line must begin with "${HOST_A}:" and nothing else. No stage directions or markdown.
- Ground everything in the retrieved sources.
- Spoken register, not written. Short sentences.
- No greeting and no sign-off.`,
  },

  debate: {
    label: 'Debate',
    speakers: [
      { speaker: HOST_A, voiceName: 'Charon' },
      { speaker: HOST_B, voiceName: 'Leda' },
    ],
    scriptPrompt: (focus) => `Write a two-person debate about the central tension in the sources. Target 800-1100 words.

${HOST_A} argues the strongest case one way; ${HOST_B} argues the strongest case against. Both must argue from evidence that is actually in the sources — this is a disagreement about interpretation, not invention. Neither side wins; end on the crux that would settle it.${focusLine(focus)}

${DIALOGUE_RULES}`,
  },

  critique: {
    label: 'Critique',
    speakers: [
      { speaker: HOST_A, voiceName: 'Umbriel' },
      { speaker: HOST_B, voiceName: 'Aoede' },
    ],
    scriptPrompt: (focus) => `Write a two-expert critical review of the sources. Target 800-1100 words.

${HOST_A} assesses what the material gets right and what is genuinely well-supported. ${HOST_B} probes the weak points: unsupported leaps, missing context, claims that rest on a single thin citation. Be specific and fair — name the actual claim you are assessing.${focusLine(focus)}

${DIALOGUE_RULES}`,
  },
};

/* -------------------------------- WAV output ------------------------------ */

/** Wraps raw 16-bit PCM in a RIFF/WAVE container so browsers can play it. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE, channels = 1): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const byteRate = sampleRate * channels * BYTES_PER_SAMPLE;

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channels * BYTES_PER_SAMPLE, true);
  view.setUint16(34, BYTES_PER_SAMPLE * 8, true);
  ascii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

export function pcmDurationMs(byteLength: number): number {
  return Math.round((byteLength / (SAMPLE_RATE * BYTES_PER_SAMPLE)) * 1000);
}

/* --------------------------------- script --------------------------------- */

/** Drops anything that is not a `Speaker: line`, so TTS never reads markup aloud. */
export function cleanScript(raw: string, speakers: string[]): string {
  const allowed = new Set(speakers.map((s) => s.toLowerCase()));
  const lines: string[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/^[*_>#\s-]+/, '').trim();
    if (!trimmed) continue;
    const match = /^([A-Za-z][A-Za-z .'-]{0,30}?)\s*:\s*(.+)$/.exec(trimmed);
    if (!match) {
      // Continuation of the previous speaker's turn.
      if (lines.length) lines[lines.length - 1] += ` ${trimmed}`;
      continue;
    }
    const [, name, text] = match;
    if (!allowed.has(name.trim().toLowerCase())) continue;
    lines.push(`${name.trim()}: ${text.trim().replace(/\*\*/g, '')}`);
  }
  return lines.join('\n');
}

/** Splits on speaker turns so a chunk boundary never lands mid-sentence. */
export function chunkScript(script: string, maxChars = CHARS_PER_CHUNK): string[] {
  const lines = script.split('\n').filter(Boolean);
  const chunks: string[] = [];
  let current = '';
  for (const line of lines) {
    if (current && current.length + line.length + 1 > maxChars) {
      chunks.push(current);
      current = '';
    }
    current = current ? `${current}\n${line}` : line;
  }
  if (current) chunks.push(current);
  return chunks;
}

/* ---------------------------------- job ----------------------------------- */

export async function runAudioJob(
  app: AppContext,
  job: {
    id: string;
    notebookId: string;
    storeName: string;
    format: AudioFormat;
    focus: string | null;
    selectedSourceIds: string[];
    allSourceIds: string[];
  },
): Promise<void> {
  const style = AUDIO_STYLES[job.format] ?? AUDIO_STYLES.deep_dive;

  try {
    const raw = await generateText(app.gemini, {
      contents: [{ role: 'user', parts: [{ text: style.scriptPrompt(job.focus) }] }],
      tools: fileSearchTool(
        job.storeName,
        scopeToSelection(job.selectedSourceIds, job.allSourceIds),
      ),
      temperature: 0.9,
      maxOutputTokens: 8192,
    });

    const script = cleanScript(
      raw,
      style.speakers.map((s) => s.speaker),
    );
    if (!script) throw new Error('The model did not return a usable script');

    await db.updateAudio(app.env.DB, job.id, { status: 'synthesizing', script });

    const chunks = chunkScript(script);
    const speakerList = style.speakers.map((s) => s.speaker).join(' and ');
    const pieces: Uint8Array[] = [];

    for (const chunk of chunks) {
      const prompt =
        style.speakers.length > 1
          ? `Read this conversation between ${speakerList} aloud. Natural pace, warm and engaged, as if recording a podcast.\n\n${chunk}`
          : `Read this aloud in a clear, engaged narration voice.\n\n${chunk}`;
      pieces.push(
        await synthesizeSpeech(app.gemini, { prompt, speakers: style.speakers }),
      );
    }

    const total = pieces.reduce((n, p) => n + p.byteLength, 0);
    const pcm = new Uint8Array(total);
    let offset = 0;
    for (const piece of pieces) {
      pcm.set(piece, offset);
      offset += piece.byteLength;
    }

    const wav = pcmToWav(pcm);
    const key = `audio/${job.notebookId}/${job.id}.wav`;
    await app.env.MEDIA.put(key, wav, {
      httpMetadata: { contentType: 'audio/wav' },
    });

    await db.updateAudio(app.env.DB, job.id, {
      status: 'ready',
      r2Key: key,
      durationMs: pcmDurationMs(total),
      error: null,
    });
  } catch (err) {
    await db.updateAudio(app.env.DB, job.id, {
      status: 'error',
      error: (err instanceof Error ? err.message : 'Audio generation failed').slice(0, 500),
    });
  }
}
