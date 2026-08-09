import type { AudioOverview, Citation, Message, Note, Notebook, Source } from './types';

export interface NotebookState {
  notebook: Notebook;
  sources: Source[];
  messages: Message[];
  notes: Note[];
  audio: AudioOverview[];
}

export interface NotebookOverview {
  summary: string;
  questions: string[];
}

export function parseOverview(description: string | null): NotebookOverview | null {
  if (!description) return null;
  try {
    const parsed = JSON.parse(description) as Partial<NotebookOverview>;
    if (typeof parsed.summary !== 'string') return null;
    return { summary: parsed.summary, questions: parsed.questions ?? [] };
  } catch {
    return { summary: description, questions: [] };
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, init);
  const text = await res.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }
  if (!res.ok) {
    const message =
      (payload as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return payload as T;
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const api = {
  createNotebook: (title?: string) =>
    request<{ notebook: Notebook }>('/api/notebooks', jsonInit('POST', { title })),

  deleteNotebook: (id: string) => request<{ ok: true }>(`/api/notebooks/${id}`, { method: 'DELETE' }),

  renameNotebook: (id: string, patch: { title?: string; emoji?: string }) =>
    request<{ notebook: Notebook }>(`/api/notebooks/${id}`, jsonInit('PATCH', patch)),

  state: (id: string) => request<NotebookState>(`/api/notebooks/${id}/state`),

  addFiles: (id: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);
    return request<{ sourceIds: string[]; sources: Source[] }>(`/api/notebooks/${id}/sources`, {
      method: 'POST',
      body: form,
    });
  },

  addText: (id: string, text: string, title?: string) =>
    request<{ sourceIds: string[]; sources: Source[] }>(
      `/api/notebooks/${id}/sources`,
      jsonInit('POST', { kind: 'text', text, title }),
    ),

  addUrl: (id: string, url: string) =>
    request<{ sourceIds: string[]; sources: Source[] }>(
      `/api/notebooks/${id}/sources`,
      jsonInit('POST', { kind: 'url', url }),
    ),

  getSource: (notebookId: string, sourceId: string) =>
    request<{ source: Source & { preview: string | null } }>(
      `/api/notebooks/${notebookId}/sources/${sourceId}`,
    ),

  deleteSource: (notebookId: string, sourceId: string) =>
    request<{ ok: true }>(`/api/notebooks/${notebookId}/sources/${sourceId}`, { method: 'DELETE' }),

  renameSource: (notebookId: string, sourceId: string, title: string) =>
    request<{ source: Source }>(
      `/api/notebooks/${notebookId}/sources/${sourceId}`,
      jsonInit('PATCH', { title }),
    ),

  refreshOverview: (id: string) =>
    request<{ notebook: Notebook }>(`/api/notebooks/${id}/overview`, jsonInit('POST')),

  clearChat: (id: string) =>
    request<{ ok: true }>(`/api/notebooks/${id}/chat`, { method: 'DELETE' }),

  generateArtifact: (id: string, artifact: string, sourceIds: string[]) =>
    request<{ note: Note }>(
      `/api/notebooks/${id}/studio`,
      jsonInit('POST', { artifact, sourceIds }),
    ),

  createNote: (id: string, note: { title: string; content: string; kind?: Note['kind'] }) =>
    request<{ note: Note }>(`/api/notebooks/${id}/notes`, jsonInit('POST', note)),

  updateNote: (id: string, noteId: string, patch: { title?: string; content?: string }) =>
    request<{ note: Note }>(`/api/notebooks/${id}/notes/${noteId}`, jsonInit('PATCH', patch)),

  deleteNote: (id: string, noteId: string) =>
    request<{ ok: true }>(`/api/notebooks/${id}/notes/${noteId}`, { method: 'DELETE' }),

  createAudio: (id: string, body: { format: string; focus?: string; sourceIds: string[] }) =>
    request<{ audio: AudioOverview }>(`/api/notebooks/${id}/audio`, jsonInit('POST', body)),

  deleteAudio: (id: string, audioId: string) =>
    request<{ ok: true }>(`/api/notebooks/${id}/audio/${audioId}`, { method: 'DELETE' }),
};

export type ChatEvent =
  | { type: 'text'; delta: string }
  | { type: 'done'; message: Message }
  | { type: 'error'; error: string };

/** Streams a grounded answer, invoking `onEvent` for each server-sent frame. */
export async function streamChat(
  notebookId: string,
  body: { message: string; sourceIds: string[] },
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/notebooks/${notebookId}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = `Request failed (${res.status})`;
    try {
      message = (JSON.parse(text) as { error?: string }).error ?? message;
    } catch {
      /* keep the default */
    }
    onEvent({ type: 'error', error: message });
    return;
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
        } catch {
          /* ignore keep-alive noise */
        }
      }
    }
  }
}

export function citationById(citations: Citation[], index: number): Citation | undefined {
  return citations.find((c) => c.index === index);
}

export function formatDuration(ms: number | null): string {
  if (!ms) return '';
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
