/**
 * Клиентът за Google, увит в трите роли поотделно.
 *
 * `Gemini` е един обект с три модела в него (чат, вграждания, реч), а
 * интерфейсите искат по един модел на роля — иначе едно и също `model` поле
 * трябва да значи три различни неща. Обвивките решават точно това и не добавят
 * логика.
 */

import type { Gemini } from '../gemini';
import { AiError, withTimeout } from './error';
import { logUsage, usageFrom, type TokenUsage } from './usage';
import type { ChatModel, EmbedModel, EmbedTask, SpeechModel } from './types';

export function googleChat(gemini: Gemini): ChatModel {
  return {
    model: gemini.chatModel,
    generateText: (input) => gemini.generateText(input),
    generateJson: (input) => gemini.generateJson(input),
    stream: async function* (input) {
      // usageMetadata идва по чанковете, като последното носи пълните числа —
      // затова се пази последното видяно и се пише един ред след края.
      let last: TokenUsage | null = null;
      for await (const chunk of gemini.stream(input)) {
        const usage = usageFrom(chunk.response);
        if (usage) last = usage;
        yield chunk;
      }
      if (last) logUsage(input.model ?? gemini.chatModel, last);
    },
  };
}

export function googleEmbed(gemini: Gemini, dimensions: number): EmbedModel {
  return {
    model: gemini.embedModel,
    dimensions,
    embed: (texts: string[], task: EmbedTask = 'RETRIEVAL_DOCUMENT') =>
      gemini.embed(texts, task, dimensions),
  };
}

export function googleTts(gemini: Gemini): SpeechModel {
  return {
    model: gemini.ttsModel,
    speak: async (input) => {
      try {
        return await withTimeout(gemini.speak(input), `TTS (${gemini.ttsModel})`);
      } catch (err) {
        throw await withTtsCandidates(gemini, err);
      }
    },
  };
}

/**
 * Превръща „този модел го няма“ в „сложи един от тези“.
 *
 * Имената на TTS моделите се менят по-често от всичко останало и не се четат от
 * документация: „Gemini 3.1 Flash TTS“ например се появява като
 * `gemini-3.1-flash-tts-preview`, а не като `gemini-3.1-flash-tts`. Затова при
 * несъществуващ модел питаме ключа кои приема и слагаме отговора в самата грешка
 * — тя стига до потребителя под аудио прегледа, значи там трябва да е и
 * решението, вместо да го праща да рови.
 *
 * Само на този път: една допълнителна заявка при вече провалена задача.
 */
async function withTtsCandidates(gemini: Gemini, err: unknown): Promise<unknown> {
  if (!(err instanceof AiError)) return err;
  if (!/not found|не съществува/i.test(err.message)) return err;

  try {
    const models = await gemini.listModels();
    const candidates = models
      .filter((m) => /tts|speech/i.test(m.id))
      .map((m) => m.id)
      .slice(0, 8);
    if (candidates.length === 0) {
      return new AiError(
        err.status,
        `${err.message} Ключът не предлага нито един TTS модел — аудио прегледът иска ключ с достъп до реч.`,
        err.detail,
      );
    }
    return new AiError(
      err.status,
      `Моделът ${gemini.ttsModel} не съществува за този ключ. Сложи TTS_MODEL в wrangler.jsonc на един от тези: ${candidates.join(', ')}.`,
      err.detail,
    );
  } catch {
    // Списъкът е удобство; ако и той падне, оригиналната грешка е по-полезна
    // от грешка за списъка.
    return err;
  }
}
