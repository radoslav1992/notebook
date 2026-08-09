const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Кратък, URL-безопасен, сортируем по време идентификатор. */
export function newId(prefix = ''): string {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  let rand = '';
  for (const b of bytes) rand += ALPHABET[b % ALPHABET.length];
  const stamp = Date.now().toString(36);
  return prefix ? `${prefix}_${stamp}${rand}` : `${stamp}${rand}`;
}

export function now(): number {
  return Date.now();
}
