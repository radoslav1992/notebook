import { useRef, useState } from 'preact/hooks';
import { ApiError, apiSend, apiUpload } from '~/lib/client';
import type { Source } from '~/lib/types';

type Mode = 'files' | 'link' | 'text';

interface Props {
  notebookId: string;
  remaining: number;
  onClose: () => void;
  onAdded: (sources: Source[]) => void;
}

const ACCEPT = '.pdf,.docx,.txt,.md,.csv,.mp3,.m4a,.wav,.ogg,.flac,.aac';

export default function AddSourceModal({ notebookId, remaining, onClose, onAdded }: Props) {
  const [mode, setMode] = useState<Mode>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<HTMLInputElement>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const incoming = Array.from(list).slice(0, Math.max(0, remaining - files.length));
    if (incoming.length > 0) {
      setFiles((prev) => [...prev, ...incoming]);
      setMode('files');
      setError('');
    } else if (remaining - files.length <= 0) {
      setError(`В тази тетрадка има място за още ${Math.max(0, remaining)} източника.`);
    }
  }

  async function submit() {
    setError('');
    setBusy(true);
    try {
      let created: Source[] = [];

      if (mode === 'files') {
        if (files.length === 0) throw new ApiError(400, 'Избери поне един файл.');
        const form = new FormData();
        for (const f of files) form.append('files', f, f.name);
        created = (await apiUpload<{ sources: Source[] }>(
          `/api/notebooks/${notebookId}/sources`,
          form,
        )).sources;
      } else if (mode === 'link') {
        if (!url.trim()) throw new ApiError(400, 'Постави адрес.');
        created = (
          await apiSend<{ sources: Source[] }>(`/api/notebooks/${notebookId}/sources`, 'POST', {
            url: url.trim(),
            name: name.trim() || undefined,
          })
        ).sources;
      } else {
        if (text.trim().length < 40) throw new ApiError(400, 'Текстът е твърде кратък.');
        created = (
          await apiSend<{ sources: Source[] }>(`/api/notebooks/${notebookId}/sources`, 'POST', {
            text,
            name: name.trim() || undefined,
          })
        ).sources;
      }

      onAdded(created);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Добавянето се провали.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Добави източник"
    >
      <div class="modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <div class="grow">
            <h2 class="modal-title">Добави източник</h2>
            <p class="modal-sub">
              Записки работи само с това, което ѝ дадеш. До 50 източника в тетрадка
              {remaining < 50 ? ` — остават ${Math.max(0, remaining)}` : ''}.
            </p>
          </div>
          <button class="modal-x" onClick={onClose} aria-label="Затвори">
            ×
          </button>
        </div>

        {mode === 'files' && (
          <>
            <div
              class={`dropzone ${over ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(true);
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setOver(false);
                addFiles(e.dataTransfer?.files ?? null);
              }}
            >
              <div class="dropzone-title">Пусни файловете тук</div>
              <div class="dropzone-sub">
                PDF, .txt, .md, Word, аудио — или{' '}
                <button onClick={() => picker.current?.click()}>избери от устройството</button>
              </div>
              <input
                ref={picker}
                type="file"
                multiple
                accept={ACCEPT}
                class="sr-only"
                onChange={(e) => addFiles((e.target as HTMLInputElement).files)}
              />
            </div>

            {files.length > 0 && (
              <div class="pending-list">
                {files.map((f, i) => (
                  <div class="pending" key={`${f.name}-${i}`}>
                    <span class="grow">{f.name}</span>
                    <span class="size">{formatSize(f.size)}</span>
                    <button
                      onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Премахни ${f.name}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div class="tabs">
          <button class={`tab ${mode === 'files' ? 'on' : ''}`} onClick={() => setMode('files')}>
            <div class="tab-title">Файлове</div>
            <div class="tab-sub">PDF, Word, текст, аудио</div>
          </button>
          <button class={`tab ${mode === 'link' ? 'on' : ''}`} onClick={() => setMode('link')}>
            <div class="tab-title">Линк</div>
            <div class="tab-sub">Уеб страница или YouTube</div>
          </button>
          <button class={`tab ${mode === 'text' ? 'on' : ''}`} onClick={() => setMode('text')}>
            <div class="tab-title">Текст</div>
            <div class="tab-sub">Постави директно</div>
          </button>
        </div>

        {mode === 'link' && (
          <div class="modal-panel">
            <input
              class="field"
              type="url"
              value={url}
              placeholder="https://ec.europa.eu/… или https://youtu.be/…"
              onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            />
            <input
              class="field"
              style={{ marginTop: '10px' }}
              value={name}
              placeholder="Име на източника (по избор)"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
          </div>
        )}

        {mode === 'text' && (
          <div class="modal-panel">
            <input
              class="field"
              value={name}
              placeholder="Име на бележката (по избор)"
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
            />
            <textarea
              class="field"
              style={{ marginTop: '10px' }}
              value={text}
              placeholder="Постави текста си тук…"
              onInput={(e) => setText((e.target as HTMLTextAreaElement).value)}
            />
          </div>
        )}

        <div class="modal-actions">
          {error && <div class="modal-error">{error}</div>}
          {!error && <div class="grow" />}
          <button class="btn cancel" onClick={onClose} disabled={busy}>
            Отказ
          </button>
          <button class="btn btn-primary confirm" onClick={submit} disabled={busy}>
            {busy ? 'Качвам…' : 'Добави'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
