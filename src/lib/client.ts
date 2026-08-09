/** Малък слой над fetch за браузъра: собствен ключ, JSON, четими грешки. */

const KEY_STORAGE = 'zapiski.geminiKey';

export function getLocalKey(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setLocalKey(key: string): void {
  if (typeof localStorage === 'undefined') return;
  const clean = key.trim();
  if (clean) localStorage.setItem(KEY_STORAGE, clean);
  else localStorage.removeItem(KEY_STORAGE);
}

export function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 4)}••••`;
  return `${key.slice(0, 4)}••••••••••${key.slice(-4)}`;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = getLocalKey();
  return { ...(key ? { 'x-gemini-key': key } : {}), ...extra };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function unwrap<T>(res: Response): Promise<T> {
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  let message = `Заявката се провали (${res.status}).`;
  let signedOut = false;
  try {
    const body = (await res.json()) as { error?: string; signedOut?: boolean };
    if (body?.error) message = body.error;
    signedOut = body?.signedOut === true;
  } catch {
    /* без тяло */
  }
  // Изтекла сесия: няма смисъл от съобщение в интерфейса, който вече не е наш.
  // Само този признак праща към входа — 401 идва и при отказан Gemini ключ.
  if (signedOut && typeof location !== 'undefined') {
    const next = encodeURIComponent(location.pathname + location.search);
    location.assign(`/login?next=${next}`);
  }
  throw new ApiError(res.status, message);
}

export async function apiGet<T>(path: string): Promise<T> {
  return unwrap<T>(await fetch(path, { headers: headers(), cache: 'no-store' }));
}

export async function apiSend<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'DELETE',
  body?: unknown,
): Promise<T> {
  return unwrap<T>(
    await fetch(path, {
      method,
      headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiUpload<T>(path: string, form: FormData): Promise<T> {
  return unwrap<T>(await fetch(path, { method: 'POST', headers: headers(), body: form }));
}

/** Чете SSE поток и подава събитията едно по едно. */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (event: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(path, {
    method: 'POST',
    headers: headers({ 'content-type': 'application/json' }),
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    await unwrap(res); // хвърля ApiError с текста от сървъра
    return;
  }
  if (!res.body) throw new ApiError(502, 'Сървърът не върна поток.');

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += value;

    let split: number;
    while ((split = buffer.indexOf('\n\n')) >= 0) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);

      let event = 'message';
      const dataLines: string[] = [];
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length === 0) continue;
      try {
        onEvent(event, JSON.parse(dataLines.join('\n')) as Record<string, unknown>);
      } catch {
        /* пропускаме повредени рамки */
      }
    }
  }
}
