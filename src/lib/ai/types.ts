/**
 * Общият език между приложението и доставчиците на модели.
 *
 * Формата е тази на Gemini (`contents` / `parts`) не от привързаност към
 * Google, а защото Cloudflare приема точно нея за партньорските модели
 * `google/*` — `env.AI.run('google/gemini-3.6-flash', { contents: [...] })`.
 * Така един и същ обект пътува и по двата пътя без превод.
 */

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

export type EmbedTask = 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY' | 'SEMANTIC_SIMILARITY';

/** Говорител в подкаста: име, както се появява в сценария, и глас. */
export interface Speaker {
  name: string;
  voice: string;
}

export interface ChatModel {
  /** Идентификаторът, както е зададен в конфигурацията. */
  readonly model: string;

  generateText(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    config?: GenerateConfig;
  }): Promise<string>;

  generateJson<T>(input: {
    model?: string;
    prompt: string;
    systemInstruction?: string;
    schema: unknown;
  }): Promise<T>;

  /**
   * Парчета текст, докато моделът пише. Доставчик без стрийминг има право да
   * върне всичко наведнъж — извикващият код не различава двата случая.
   */
  stream(input: {
    model?: string;
    contents: Content[];
    systemInstruction?: string;
    config?: GenerateConfig;
  }): AsyncGenerator<{ text: string }>;
}

export interface EmbedModel {
  readonly model: string;
  /** Ширината на вектора. Трябва да съвпада с Vectorize индекса. */
  readonly dimensions: number;
  embed(texts: string[], task?: EmbedTask): Promise<number[][]>;
}

export interface SpeechModel {
  readonly model: string;
  /**
   * Сурово PCM (16-bit little-endian) и честотата му. При двама говорители
   * доставчикът или ги озвучава наведнъж, или сам разделя репликите.
   */
  speak(input: { text: string; speakers?: Speaker[]; voice?: string }): Promise<{
    pcm: Uint8Array;
    sampleRate: number;
  }>;
}
