/**
 * Клиентът за Google, увит в трите роли поотделно.
 *
 * `Gemini` е един обект с три модела в него (чат, вграждания, реч), а
 * интерфейсите искат по един модел на роля — иначе едно и също `model` поле
 * трябва да значи три различни неща. Обвивките решават точно това и не добавят
 * логика.
 */

import type { Gemini } from '../gemini';
import type { ChatModel, EmbedModel, EmbedTask, SpeechModel } from './types';

export function googleChat(gemini: Gemini): ChatModel {
  return {
    model: gemini.chatModel,
    generateText: (input) => gemini.generateText(input),
    generateJson: (input) => gemini.generateJson(input),
    stream: (input) => gemini.stream(input),
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
    speak: (input) => gemini.speak(input),
  };
}
