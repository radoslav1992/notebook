/**
 * Кои модели може да избере потребителят в Настройки.
 *
 * Списъкът идва от конфигурацията на инсталацията, а не от твърдо изброени
 * имена в кода: инсталация на Cloudflare няма как да предлага „Gemini 2.5 Pro“,
 * а инсталация на Google — „@cf/meta/llama-…“. Затова има точно две променливи —
 * обикновеният модел и по-добрият за платените планове.
 */

import { FALLBACK_CHAT_MODEL } from './defaults';
import { providerFor } from './select';

export interface ModelChoice {
  value: string;
  label: string;
  /** Само за платени планове. */
  pro: boolean;
}

export { FALLBACK_CHAT_MODEL };

export interface ModelConfig {
  chatModel?: string;
  chatModelPro?: string;
}

export function defaultChatModel(cfg: ModelConfig): string {
  return cfg.chatModel?.trim() || FALLBACK_CHAT_MODEL;
}

export function modelChoices(cfg: ModelConfig): ModelChoice[] {
  const base = defaultChatModel(cfg);
  const pro = cfg.chatModelPro?.trim();
  const out: ModelChoice[] = [{ value: base, label: labelFor(base), pro: false }];
  if (pro && pro !== base) out.push({ value: pro, label: labelFor(pro), pro: true });
  return out;
}

/**
 * Моделът за този разговор: избраният от потребителя, ако инсталацията още го
 * предлага и планът го позволява; иначе обикновеният.
 *
 * Проверката е по точно съвпадение, а не по „името съдържа pro“ — при
 * Cloudflare имената изглеждат съвсем другояче.
 */
export function resolveChatModel(
  cfg: ModelConfig,
  chosen: string | null | undefined,
  proAllowed: boolean,
): string {
  const choices = modelChoices(cfg);
  const match = chosen ? choices.find((c) => c.value === chosen.trim()) : undefined;
  if (!match) return defaultChatModel(cfg);
  if (match.pro && !proAllowed) return defaultChatModel(cfg);
  return match.value;
}

/**
 * Четимо име от идентификатора: „google/gemini-3.6-flash“ →
 * „Gemini 3.6 Flash — през Cloudflare“. Не е речник, за да работи и с модел,
 * който още не съществува, когато това се пише.
 */
export function labelFor(model: string): string {
  const via = providerFor(model) === 'cloudflare' ? 'през Cloudflare' : 'през Google';
  const tail = model.replace(/^@cf\//, '').split('/').pop() ?? model;
  // Дели се само на тире и долна черта: точката е част от номера на версията,
  // а „3.1“ не бива да става „3 1“.
  const words = tail.split(/[-_]/).filter(Boolean).map(word);
  return `${words.join(' ')} — ${via}`;
}

const ACRONYMS: Record<string, string> = {
  tts: 'TTS',
  stt: 'STT',
  ai: 'AI',
  llm: 'LLM',
  gpt: 'GPT',
  fp8: 'FP8',
};

function word(w: string): string {
  const acronym = ACRONYMS[w.toLowerCase()];
  if (acronym) return acronym;
  // „3.1“, „70b“, „v1.5“ си остават както са.
  if (/^\d/.test(w)) return w;
  return w.charAt(0).toUpperCase() + w.slice(1);
}
