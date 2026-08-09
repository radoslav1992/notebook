/**
 * Единственото място, което говори с Google Generative Language API.
 *
 * Всичко Google-специфично живее тук: адреси, имена на полета, форма на
 * отговорите. Ако Google промени нещо, се пипа само този файл.
 *
 * Използвани възможности:
 *   • generateContent / streamGenerateContent — отговори по източници
 *   • embedContent / batchEmbedContents      — вграждания за търсенето
 *   • fileSearchStores + инструмент fileSearch — управляван RAG на Google
 *   • generateContent с responseModalities:AUDIO — TTS с двама водещи
 */

const DEFAULT_HOST = 'https://generativelanguage.googleapis.com';

export class GeminiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
    /**
     * Проблем с ключа, а не със самата заявка. Google връща част от тези с 400,
     * затова статусът не е достатъчен, за да се разпознаят.
     */
    readonly keyProblem = false,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/* ── Типове по протокола ─────────────────────────────────────────────────── */

export interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  fileData?: { mimeType?: string; fileUri: string };
}

export interface Content {
  role?: 'user' | 'model';
  parts: Part[];
}

export interface GenerateConfig {
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
  responseMimeType?: string;
  responseSchema?: unknown;
  thinkingConfig?: { thinkingBudget?: number };
}

export interface GroundingChunk {
  retrievedContext?: { title?: string; text?: string; uri?: string };
  web?: { title?: string; uri?: string };
}

export interface GenerateResponse {
  candidates?: {
    content?: Content;
    finishReason?: string;
    groundingMetadata?: {
      groundingChunks?: GroundingChunk[];
      groundingSupports?: {
        segment?: { startIndex?: number; endIndex?: number; text?: string };
        groundingChunkIndices?: number[];
      }[];
    };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

/* ── Клиент ──────────────────────────────────────────────────────────────── */

export interface GeminiOptions {
  apiKey: string;
  chatModel?: string;
  embedModel?: string;
  ttsModel?: string;
  /** Различен адрес на API-то — за прокси или за тестове. */
  host?: string;
}

export class Gemini {
  readonly chatModel: string;
  readonly embedModel: string;
  readonly ttsModel: string;
  #key: string;
  #base: string;
  #uploadBase: string;

  constructor(opts: GeminiOptions) {
    if (!opts.apiKey) throw new GeminiError(401, 'Липсва Gemini API ключ.');
    this.#key = opts.apiKey;
    this.chatModel = opts.chatModel || 'gemini-2.5-flash';
    this.embedModel = opts.embedModel || 'gemini-embedding-001';
    this.ttsModel = opts.ttsModel || 'gemini-2.5-flash-preview-tts';
    const host = (opts.host || DEFAULT_HOST).replace(/\/+$/, '');
    this.#base = `${host}/v1beta`;
    this.#uploadBase = `${host}/upload/v1beta`;
  }

  /* ── низово ниво ───────────────────────────────────────────────────────── */

  async #call<T>(path: string, body: unknown, init: { base?: string; method?: string } = {}): Promise<T> {
    const base = init.base ?? this.#base;
    const res = await withRetry(() =>
      fetch(`${base}/${path}`, {
        method: init.method ?? 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': this.#key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
    if (!res.ok) throw await geminiError(res);
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async #get<T>(path: string): Promise<T> {
    const res = await withRetry(() =>
      fetch(`${this.#base}/${path}`, { headers: { 'x-goog-api-key': this.#key } }),
    );
    if (!res.ok) throw await geminiError(res);
    return (await res.json()) as T;
  }

  /* ── генериране ────────────────────────────────────────────────────────── */

  async generate(input: {
    model?: string;
    contents: Content[];
    systemInstruction?: string;
    config?: GenerateConfig;
    tools?: unknown[];
  }): Promise<GenerateResponse> {
    const model = input.model ?? this.chatModel;
    return this.#call<GenerateResponse>(`models/${model}:generateContent`, {
      contents: input.contents,
      ...(input.systemInstruction
        ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
        : {}),
      ...(input.tools ? { tools: input.tools } : {}),
      generationConfig: input.config ?? {},
      safetySettings: RELAXED_SAFETY,
    });
  }

  /** Удобен вариант: връща само текста. */
  async generateText(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    config?: GenerateConfig;
  }): Promise<string> {
    const res = await this.generate({
      model: input.model,
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      systemInstruction: input.systemInstruction,
      config: input.config,
    });
    return textOf(res);
  }

  /** Генериране със схема; връща разпарсен JSON. */
  async generateJson<T>(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    schema: unknown;
  }): Promise<T> {
    const res = await this.generate({
      model: input.model,
      contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
      systemInstruction: input.systemInstruction,
      config: { responseMimeType: 'application/json', responseSchema: input.schema, temperature: 0.3 },
    });
    const raw = textOf(res).trim();
    try {
      return JSON.parse(raw) as T;
    } catch {
      // Понякога моделът обгражда JSON-а с ```json ... ```
      const m = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (m) return JSON.parse(m[0]) as T;
      throw new GeminiError(502, 'Моделът върна невалиден JSON.', raw.slice(0, 400));
    }
  }

  /** Стриймва парчета текст (SSE). Последният елемент носи и метаданните. */
  async *stream(input: {
    model?: string;
    contents: Content[];
    systemInstruction?: string;
    config?: GenerateConfig;
    tools?: unknown[];
  }): AsyncGenerator<{ text: string; response: GenerateResponse }> {
    const model = input.model ?? this.chatModel;
    const res = await withRetry(() =>
      fetch(`${this.#base}/models/${model}:streamGenerateContent?alt=sse`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.#key },
        body: JSON.stringify({
          contents: input.contents,
          ...(input.systemInstruction
            ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } }
            : {}),
          ...(input.tools ? { tools: input.tools } : {}),
          generationConfig: input.config ?? {},
          safetySettings: RELAXED_SAFETY,
        }),
      }),
    );
    if (!res.ok) throw await geminiError(res);
    if (!res.body) throw new GeminiError(502, 'Празен поток от модела.');

    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
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
        let parsed: GenerateResponse;
        try {
          parsed = JSON.parse(payload) as GenerateResponse;
        } catch {
          continue;
        }
        yield { text: textOf(parsed), response: parsed };
      }
    }
  }

  /* ── вграждания ────────────────────────────────────────────────────────── */

  /**
   * Вгражда пасажи. Cloudflare Vectorize приема най-много 1536 измерения,
   * затова свиваме изхода и нормализираме (при < 3072 Google не нормализира сам).
   */
  async embed(
    texts: string[],
    taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY' = 'RETRIEVAL_DOCUMENT',
    dimensions = 1536,
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const model = this.embedModel;

    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text: text.slice(0, 8000) }] },
      taskType,
      outputDimensionality: dimensions,
    }));

    try {
      const res = await this.#call<{ embeddings?: { values: number[] }[] }>(
        `models/${model}:batchEmbedContents`,
        { requests },
      );
      const out = res.embeddings ?? [];
      if (out.length === texts.length) return out.map((e) => normalize(e.values));
    } catch (err) {
      // Някои варианти на модела не поддържат групово вграждане — падаме към единични.
      if (!(err instanceof GeminiError) || err.status < 400 || err.status >= 500) throw err;
    }

    const single = await mapWithConcurrency(requests, 6, async (req) => {
      const res = await this.#call<{ embedding?: { values: number[] } }>(
        `models/${model}:embedContent`,
        req,
      );
      return normalize(res.embedding?.values ?? []);
    });
    return single;
  }

  /* ── File Search: управляваният RAG на Google ─────────────────────────── */

  async createFileSearchStore(displayName: string): Promise<string> {
    const res = await this.#call<{ name: string }>('fileSearchStores', { displayName });
    return res.name; // „fileSearchStores/xxxxx“
  }

  async deleteFileSearchStore(storeName: string): Promise<void> {
    await this.#call(`${storeName}?force=true`, undefined, { method: 'DELETE' });
  }

  /**
   * Качва документ директно в хранилището (качване + вграждане наведнъж) и
   * изчаква дългата операция да завърши.
   */
  async uploadToFileSearchStore(input: {
    storeName: string;
    bytes: ArrayBuffer | Uint8Array;
    mimeType: string;
    displayName: string;
    customMetadata?: { key: string; stringValue?: string; numericValue?: number }[];
    maxTokensPerChunk?: number;
    maxOverlapTokens?: number;
  }): Promise<string> {
    const storeId = input.storeName.replace(/^fileSearchStores\//, '');
    const metadata = {
      displayName: input.displayName,
      ...(input.customMetadata ? { customMetadata: input.customMetadata } : {}),
      chunkingConfig: {
        whiteSpaceConfig: {
          maxTokensPerChunk: input.maxTokensPerChunk ?? 400,
          maxOverlapTokens: input.maxOverlapTokens ?? 80,
        },
      },
    };

    const body = new FormData();
    body.append(
      'metadata',
      new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
    );
    const view = input.bytes instanceof Uint8Array ? input.bytes : new Uint8Array(input.bytes);
    body.append('file', new Blob([view as BlobPart], { type: input.mimeType }), input.displayName);

    const res = await withRetry(() =>
      fetch(`${this.#uploadBase}/fileSearchStores/${storeId}:uploadToFileSearchStore`, {
        method: 'POST',
        headers: { 'x-goog-api-key': this.#key },
        body,
      }),
    );
    if (!res.ok) throw await geminiError(res);
    const op = (await res.json()) as { name?: string; done?: boolean; response?: { document?: { name?: string } } };

    const finished = op.done ? op : await this.awaitOperation(op.name!);
    return finished.response?.document?.name ?? '';
  }

  async awaitOperation(
    name: string,
    { timeoutMs = 180_000, intervalMs = 1500 } = {},
  ): Promise<{ done?: boolean; response?: { document?: { name?: string } }; error?: { message?: string } }> {
    const deadline = Date.now() + timeoutMs;
    let wait = intervalMs;
    while (Date.now() < deadline) {
      await sleep(wait);
      wait = Math.min(wait * 1.4, 8000);
      const op = await this.#get<{
        done?: boolean;
        response?: { document?: { name?: string } };
        error?: { message?: string };
      }>(name);
      if (op.done) {
        if (op.error) throw new GeminiError(502, op.error.message ?? 'Индексирането се провали.');
        return op;
      }
    }
    throw new GeminiError(504, 'Индексирането отне твърде дълго.');
  }

  /** Инструментът за търсене в хранилищата — подава се в `tools`. */
  static fileSearchTool(storeNames: string[], metadataFilter?: string): unknown {
    return {
      fileSearch: {
        fileSearchStoreNames: storeNames,
        ...(metadataFilter ? { metadataFilter } : {}),
      },
    };
  }

  /* ── Реч ───────────────────────────────────────────────────────────────── */

  /**
   * Синтезира реч. При подадени двама говорители се ползва multi-speaker TTS
   * (Google поддържа точно два гласа в един запис).
   * Връща сурово PCM (16-bit little-endian) и честотата на дискретизация.
   */
  async speak(input: {
    text: string;
    speakers?: { name: string; voice: string }[];
    voice?: string;
    model?: string;
  }): Promise<{ pcm: Uint8Array; sampleRate: number }> {
    const model = input.model ?? this.ttsModel;
    const speechConfig =
      input.speakers && input.speakers.length > 1
        ? {
            multiSpeakerVoiceConfig: {
              speakerVoiceConfigs: input.speakers.slice(0, 2).map((s) => ({
                speaker: s.name,
                voiceConfig: { prebuiltVoiceConfig: { voiceName: s.voice } },
              })),
            },
          }
        : {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: input.voice ?? input.speakers?.[0]?.voice ?? 'Kore' },
            },
          };

    const res = await this.#call<GenerateResponse>(`models/${model}:generateContent`, {
      contents: [{ role: 'user', parts: [{ text: input.text }] }],
      generationConfig: { responseModalities: ['AUDIO'], speechConfig },
    });

    const part = res.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    const data = part?.inlineData?.data;
    if (!data) {
      const reason = res.promptFeedback?.blockReason ?? res.candidates?.[0]?.finishReason ?? '';
      throw new GeminiError(502, `Моделът не върна аудио${reason ? ` (${reason})` : ''}.`);
    }
    return {
      pcm: base64ToBytes(data),
      sampleRate: sampleRateFromMime(part!.inlineData!.mimeType),
    };
  }
}

/* ── Помощни ─────────────────────────────────────────────────────────────── */

/** Аудио прегледът е обсъждане на потребителски документи — не филтрираме прекомерно. */
const RELAXED_SAFETY = [
  'HARM_CATEGORY_HARASSMENT',
  'HARM_CATEGORY_HATE_SPEECH',
  'HARM_CATEGORY_SEXUALLY_EXPLICIT',
  'HARM_CATEGORY_DANGEROUS_CONTENT',
].map((category) => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

export function textOf(res: GenerateResponse): string {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  return parts
    .map((p) => p.text ?? '')
    .join('')
    .trim();
}

/** Грундиращите пасажи, върнати от инструмента File Search. */
export function groundingChunksOf(res: GenerateResponse): GroundingChunk[] {
  return res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
}

async function geminiError(res: Response): Promise<GeminiError> {
  let detail: unknown;
  let raw = '';
  try {
    const body = (await res.json()) as { error?: { message?: string; status?: string } };
    detail = body;
    raw = body?.error?.message ?? '';
  } catch {
    try {
      detail = await res.text();
    } catch {
      /* без тяло */
    }
  }
  const message = raw
    ? translateGoogleError(res.status, raw)
    : `Gemini API отговори с ${res.status}`;
  return new GeminiError(res.status, message, detail, isKeyProblem(res.status, raw));
}

/** Ключът е отказан, изтекъл, ограничен или без включено API. */
function isKeyProblem(status: number, raw: string): boolean {
  const t = raw.toLowerCase();
  return (
    t.includes('api key not valid') ||
    t.includes('api_key_invalid') ||
    t.includes('api key expired') ||
    t.includes('are blocked') ||
    t.includes('api_key_http_referrer_blocked') ||
    t.includes('has not been used in project') ||
    t.includes('it is disabled') ||
    status === 401 ||
    status === 403
  );
}

/**
 * Google отговаря на английски, а приложението е на български — и тези
 * съобщения стигат до потребителя (например под източник, който не е минал).
 * Разпознатите случаи се превеждат и казват какво да се направи; суровият
 * текст остава в `detail` и в лога.
 */
export function translateGoogleError(status: number, raw: string): string {
  const t = raw.toLowerCase();

  if (t.includes('api key not valid') || t.includes('api_key_invalid')) {
    return 'Gemini API ключът е отказан от Google. Провери стойността му — най-често е сгрешен, с излишен знак в началото или в края, или е от друг проект.';
  }
  if (t.includes('api key expired')) {
    return 'Gemini API ключът е изтекъл. Направи нов в Google AI Studio.';
  }
  if (t.includes('api keys are not supported') || t.includes('expected oauth2')) {
    return 'Този метод на Google не приема API ключ. Това е грешка в приложението, не в ключа.';
  }
  if (t.includes('are blocked') || t.includes('api_key_http_referrer_blocked')) {
    return 'Google блокира заявката заради ограниченията на ключа. Махни ограниченията по адрес или разреши Generative Language API за него.';
  }
  if (t.includes('has not been used in project') || t.includes('it is disabled')) {
    return 'Generative Language API не е включен за проекта на този ключ. Включи го в Google Cloud Console и опитай пак след минута.';
  }
  if (t.includes('user location is not supported')) {
    return 'Google не обслужва заявки от местоположението на този ключ.';
  }
  if (t.includes('quota') || status === 429) {
    return 'Достигнат е лимитът на Gemini API. Опитай пак след малко.';
  }
  if (t.includes('not found') && t.includes('model')) {
    return 'Моделът не съществува или не е достъпен за този ключ. Провери CHAT_MODEL, EMBED_MODEL и TTS_MODEL.';
  }
  if (status === 401 || status === 403) {
    return 'Google отказа заявката с този ключ.';
  }
  return raw;
}

async function withRetry(fn: () => Promise<Response>, attempts = 4): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fn();
      // 429 и 5xx си заслужават повторен опит; останалите са наши грешки.
      if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
        if (i === attempts - 1) return res;
        await sleep(backoff(i, res.headers.get('retry-after')));
        continue;
      }
      return res;
    } catch (err) {
      lastError = err;
      if (i === attempts - 1) break;
      await sleep(backoff(i, null));
    }
  }
  throw new GeminiError(503, 'Няма връзка с Gemini API.', String(lastError));
}

function backoff(attempt: number, retryAfter: string | null): number {
  const hinted = retryAfter ? Number(retryAfter) * 1000 : 0;
  const exp = 2 ** attempt * 500;
  return Math.min(Math.max(hinted, exp) + Math.random() * 250, 15_000);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function normalize(values: number[]): number[] {
  let sum = 0;
  for (const v of values) sum += v * v;
  const len = Math.sqrt(sum);
  if (!len || !Number.isFinite(len)) return values;
  return values.map((v) => v / len);
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    s += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(s);
}

/** „audio/L16;codec=pcm;rate=24000“ → 24000 */
function sampleRateFromMime(mime: string): number {
  const m = /rate=(\d+)/.exec(mime);
  return m ? Number(m[1]) : 24_000;
}
