/**
 * Реалният разход на токени, както го докладва самият модел.
 *
 * Съществува, защото цените се смятаха по оценка „колко токена дава кирилицата“
 * — правдоподобна, но неизмерена. Ако е с 30% встрани, маржът на Про пада от
 * ~59% на ~40%. Един ред в лога на отговор и след седмица има истински числа.
 *
 * Токените за мислене се броят отделно: те се таксуват като изход, а не се
 * виждат в текста — точно перото, което може тихо да развали сметката.
 */

export interface TokenUsage {
  input?: number;
  output?: number;
  /** Токени за мислене — таксуват се като изход. */
  reasoning?: number;
}

/**
 * Изважда разхода от отговор в която и да е от трите форми — или от финалното
 * събитие на поток. Връща `null`, когато отговорът не носи разход (обикновените
 * парчета от поток), за да може викащият просто да пази последното видяно.
 */
export function usageFrom(res: unknown): TokenUsage | null {
  if (!res || typeof res !== 'object') return null;
  const r = res as {
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      output_tokens_details?: { reasoning_tokens?: number };
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    response?: { usage?: unknown };
  };

  // Gemini (и директно, и през google/* в Workers AI).
  if (r.usageMetadata) {
    return clean({
      input: r.usageMetadata.promptTokenCount,
      output: r.usageMetadata.candidatesTokenCount,
      reasoning: r.usageMetadata.thoughtsTokenCount,
    });
  }

  // Responses API: на цял отговор — `usage`; на поток — във финалното събитие
  // `response.completed`, където разходът е вложен в `response.usage`.
  if (r.usage) {
    return clean({
      input: r.usage.input_tokens ?? r.usage.prompt_tokens,
      output: r.usage.output_tokens ?? r.usage.completion_tokens,
      reasoning: r.usage.output_tokens_details?.reasoning_tokens,
    });
  }
  if (r.response && typeof r.response === 'object' && (r.response as { usage?: unknown }).usage) {
    return usageFrom(r.response);
  }

  return null;
}

function clean(u: TokenUsage): TokenUsage | null {
  const out: TokenUsage = {};
  if (typeof u.input === 'number') out.input = u.input;
  if (typeof u.output === 'number') out.output = u.output;
  if (typeof u.reasoning === 'number') out.reasoning = u.reasoning;
  return Object.keys(out).length ? out : null;
}

/**
 * Един ред в лога, четим от `wrangler tail`. Стойностите са числа, за да може
 * после да се съберат наум или със скрипт, без разбор на текст.
 */
export function logUsage(model: string, usage: TokenUsage): void {
  console.log('[zapiski:usage]', {
    model,
    input: usage.input ?? null,
    output: usage.output ?? null,
    reasoning: usage.reasoning ?? null,
  });
}
