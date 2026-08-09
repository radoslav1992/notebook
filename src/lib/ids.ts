const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Short, URL-safe, collision-resistant id. */
export function newId(prefix = ''): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let out = '';
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return prefix ? `${prefix}_${out}` : out;
}

export function now(): number {
  return Date.now();
}
