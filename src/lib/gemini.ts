/**
 * Minimal REST client for the Gemini API, written against `fetch` so it runs
 * unchanged inside a Cloudflare Worker (no Node built-ins, no SDK).
 *
 * Covers the three pieces this app needs:
 *   - File Search stores  → managed RAG (chunking, embedding, retrieval, citations)
 *   - generateContent     → grounded answers + Studio artifacts
 *   - TTS models          → multi-speaker Audio Overviews
 */

const API_ROOT = 'https://generativelanguage.googleapis.com';
const V = 'v1beta';

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

export interface GeminiConfig {
  apiKey: string;
  chatModel: string;
  ttsModel: string;
}

function headers(apiKey: string, extra: Record<string, string> = {}): Record<string, string> {
  return { 'x-goog-api-key': apiKey, ...extra };
}

async function readError(res: Response): Promise<never> {
  const text = await res.text().catch(() => '');
  let detail: unknown = text;
  let message = text.slice(0, 400);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } };
    detail = parsed;
    if (parsed.error?.message) message = parsed.error.message;
  } catch {
    /* not JSON — keep the raw body */
  }
  throw new GeminiError(message || `Gemini request failed (${res.status})`, res.status, detail);
}

async function apiJson<T>(
  cfg: GeminiConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${API_ROOT}/${V}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: headers(cfg.apiKey, {
      'content-type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    }),
  });
  if (!res.ok) await readError(res);
  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------- */
/* File Search stores                                                          */
/* -------------------------------------------------------------------------- */

export interface FileSearchStore {
  name: string; // "fileSearchStores/abc123"
  displayName?: string;
}

export interface Operation {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export async function createStore(cfg: GeminiConfig, displayName: string): Promise<FileSearchStore> {
  return apiJson<FileSearchStore>(cfg, 'fileSearchStores', {
    method: 'POST',
    body: JSON.stringify({ displayName: displayName.slice(0, 120) }),
  });
}

export async function deleteStore(cfg: GeminiConfig, storeName: string): Promise<void> {
  const res = await fetch(`${API_ROOT}/${V}/${storeName}?force=true`, {
    method: 'DELETE',
    headers: headers(cfg.apiKey),
  });
  // 404 means someone already removed it — that is the state we wanted.
  if (!res.ok && res.status !== 404) await readError(res);
}

export async function deleteDocument(cfg: GeminiConfig, docName: string): Promise<void> {
  const res = await fetch(`${API_ROOT}/${V}/${docName}`, {
    method: 'DELETE',
    headers: headers(cfg.apiKey),
  });
  if (!res.ok && res.status !== 404) await readError(res);
}

/**
 * Upload bytes straight into a File Search store. Gemini handles extraction,
 * chunking and embedding server-side, so PDFs/DOCX go in as-is — we never have
 * to parse them in the Worker.
 *
 * Uses the resumable upload protocol (start → upload+finalize), which is the
 * only protocol available for `:uploadToFileSearchStore`.
 */
export async function uploadToStore(
  cfg: GeminiConfig,
  opts: {
    storeName: string;
    displayName: string;
    mimeType: string;
    bytes: ArrayBuffer;
    /** Custom metadata, used later to scope retrieval to selected sources. */
    customMetadata?: Record<string, string>;
  },
): Promise<Operation> {
  const start = await fetch(`${API_ROOT}/upload/${V}/${opts.storeName}:uploadToFileSearchStore`, {
    method: 'POST',
    headers: headers(cfg.apiKey, {
      'content-type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(opts.bytes.byteLength),
      'X-Goog-Upload-Header-Content-Type': opts.mimeType,
    }),
    body: JSON.stringify({
      displayName: opts.displayName.slice(0, 240),
      customMetadata: Object.entries(opts.customMetadata ?? {}).map(([key, value]) => ({
        key,
        stringValue: value,
      })),
    }),
  });
  if (!start.ok) await readError(start);

  const uploadUrl =
    start.headers.get('x-goog-upload-url') ?? start.headers.get('X-Goog-Upload-URL');
  if (!uploadUrl) {
    throw new GeminiError('Gemini did not return an upload URL', 502);
  }

  const finish = await fetch(uploadUrl, {
    method: 'POST',
    headers: headers(cfg.apiKey, {
      'content-length': String(opts.bytes.byteLength),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    }),
    body: opts.bytes,
  });
  if (!finish.ok) await readError(finish);
  return (await finish.json()) as Operation;
}

export async function getOperation(cfg: GeminiConfig, name: string): Promise<Operation> {
  return apiJson<Operation>(cfg, name);
}

/**
 * Poll an import operation until it settles. Import of a normal document
 * finishes in a few seconds; the cap keeps a stuck job from pinning a request.
 */
export async function waitForOperation(
  cfg: GeminiConfig,
  name: string,
  { timeoutMs = 240_000, intervalMs = 1_500 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<Operation> {
  const deadline = Date.now() + timeoutMs;
  let op = await getOperation(cfg, name);
  while (!op.done) {
    if (Date.now() > deadline) {
      throw new GeminiError('Timed out waiting for the document to finish indexing', 504);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    op = await getOperation(cfg, name);
  }
  if (op.error) throw new GeminiError(op.error.message, 502, op.error);
  return op;
}

/* -------------------------------------------------------------------------- */
/* Content generation                                                          */
/* -------------------------------------------------------------------------- */

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  /** Points at a Files API resource or a public YouTube URL. */
  fileData?: { mimeType?: string; fileUri: string };
}
export interface Content {
  role?: 'user' | 'model';
  parts: Part[];
}

export interface GroundingChunk {
  retrievedContext?: {
    title?: string;
    text?: string;
    documentName?: string;
  };
}

export interface GroundingSupport {
  segment?: { startIndex?: number; endIndex?: number; text?: string };
  groundingChunkIndices?: number[];
}

export interface GroundingMetadata {
  groundingChunks?: GroundingChunk[];
  groundingSupports?: GroundingSupport[];
}

export interface Candidate {
  content?: Content;
  finishReason?: string;
  groundingMetadata?: GroundingMetadata;
}

export interface GenerateContentResponse {
  candidates?: Candidate[];
  promptFeedback?: { blockReason?: string };
}

export interface FileSearchTool {
  fileSearch: {
    fileSearchStoreNames: string[];
    metadataFilter?: string;
  };
}

export interface GenerateOptions {
  model?: string;
  contents: Content[];
  systemInstruction?: string;
  tools?: FileSearchTool[];
  temperature?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  signal?: AbortSignal;
}

function buildBody(opts: GenerateOptions): Record<string, unknown> {
  const generationConfig: Record<string, unknown> = {};
  if (opts.temperature !== undefined) generationConfig.temperature = opts.temperature;
  if (opts.maxOutputTokens !== undefined) generationConfig.maxOutputTokens = opts.maxOutputTokens;
  if (opts.responseMimeType) generationConfig.responseMimeType = opts.responseMimeType;

  return {
    contents: opts.contents,
    ...(opts.systemInstruction
      ? { systemInstruction: { parts: [{ text: opts.systemInstruction }] } }
      : {}),
    ...(opts.tools?.length ? { tools: opts.tools } : {}),
    ...(Object.keys(generationConfig).length ? { generationConfig } : {}),
  };
}

export async function generateContent(
  cfg: GeminiConfig,
  opts: GenerateOptions,
): Promise<GenerateContentResponse> {
  const model = opts.model ?? cfg.chatModel;
  return apiJson<GenerateContentResponse>(cfg, `models/${model}:generateContent`, {
    method: 'POST',
    body: JSON.stringify(buildBody(opts)),
    signal: opts.signal,
  });
}

/** Convenience wrapper: run a prompt and return the concatenated text. */
export async function generateText(cfg: GeminiConfig, opts: GenerateOptions): Promise<string> {
  const res = await generateContent(cfg, opts);
  return textOf(res);
}

export function textOf(res: GenerateContentResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/**
 * Server-sent-events streaming. Yields each raw chunk so the caller can forward
 * text incrementally and still collect grounding metadata from the final chunks.
 */
export async function* streamGenerateContent(
  cfg: GeminiConfig,
  opts: GenerateOptions,
): AsyncGenerator<GenerateContentResponse> {
  const model = opts.model ?? cfg.chatModel;
  const res = await fetch(
    `${API_ROOT}/${V}/models/${model}:streamGenerateContent?alt=sse`,
    {
      method: 'POST',
      headers: headers(cfg.apiKey, { 'content-type': 'application/json' }),
      body: JSON.stringify(buildBody(opts)),
      signal: opts.signal,
    },
  );
  if (!res.ok) await readError(res);
  if (!res.body) throw new GeminiError('Gemini returned an empty stream', 502);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          yield JSON.parse(payload) as GenerateContentResponse;
        } catch {
          /* ignore malformed keep-alive frames */
        }
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Text to speech                                                              */
/* -------------------------------------------------------------------------- */

export interface SpeakerVoice {
  speaker: string;
  voiceName: string;
}

/** Returns raw 16-bit PCM at 24 kHz, mono (the format Gemini TTS emits). */
export async function synthesizeSpeech(
  cfg: GeminiConfig,
  opts: { prompt: string; speakers: SpeakerVoice[]; model?: string; signal?: AbortSignal },
): Promise<Uint8Array> {
  const model = opts.model ?? cfg.ttsModel;

  const speechConfig =
    opts.speakers.length > 1
      ? {
          multiSpeakerVoiceConfig: {
            speakerVoiceConfigs: opts.speakers.map((s) => ({
              speaker: s.speaker,
              voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voiceName } },
            })),
          },
        }
      : {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: opts.speakers[0]?.voiceName ?? 'Kore' },
          },
        };

  const res = await apiJson<GenerateContentResponse>(cfg, `models/${model}:generateContent`, {
    method: 'POST',
    body: JSON.stringify({
      contents: [{ parts: [{ text: opts.prompt }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig },
    }),
    signal: opts.signal,
  });

  const data = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
  if (!data) {
    throw new GeminiError('TTS response contained no audio', 502, res);
  }
  return base64ToBytes(data);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The 30 prebuilt Gemini TTS voices, grouped loosely by character. */
export const TTS_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
] as const;
