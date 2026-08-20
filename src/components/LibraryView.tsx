import { useEffect, useRef, useState } from 'preact/hooks';
import { ApiError, apiGet, apiSend, apiUpload } from '~/lib/client';
import type { Source } from '~/lib/types';

interface Props {
  libraryId: string;
  sources: Source[];
  canWrite: boolean;
}

/**
 * Съдържанието на общата библиотека.
 *
 * Качването минава през същия маршрут като личните източници
 * (`/api/notebooks/:id/sources`), защото библиотеката е тетрадка — вратата за нея
 * е отворена изрично в `requireNotebook`. Затова тук няма своя логика за файлове,
 * линкове и обработка.
 */
export default function LibraryView({ libraryId, sources: initial, canWrite }: Props) {
  const [sources, setSources] = useState(initial);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  // Обработката е фонова, затова се опреснява, докато има нещо в движение.
  const working = sources.some((s) => s.status === 'pending' || s.status === 'indexing');
  useEffect(() => {
    if (!working) return;
    const timer = setInterval(async () => {
      try {
        const r = await apiGet<{ sources: Source[] }>(`/api/notebooks/${libraryId}/sources`);
        setSources(r.sources);
      } catch {
        // Мрежова засечка не бива да спира таймера — следващият тик ще успее.
      }
    }, 2500);
    return () => clearInterval(timer);
  }, [working, libraryId]);

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const form = new FormData();
    for (const f of Array.from(files)) form.append('files', f);
    setBusy('files');
    setError('');
    try {
      const r = await apiUpload<{ sources: Source[] }>(
        `/api/notebooks/${libraryId}/sources`,
        form,
      );
      setSources((list) => [...list, ...r.sources]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Файловете не бяха качени.');
    } finally {
      setBusy('');
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function addUrl(e: Event) {
    e.preventDefault();
    if (!url.trim()) return;
    setBusy('url');
    setError('');
    try {
      const r = await apiSend<{ sources: Source[] }>(
        `/api/notebooks/${libraryId}/sources`,
        'POST',
        { url },
      );
      setSources((list) => [...list, ...r.sources]);
      setUrl('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Адресът не беше добавен.');
    } finally {
      setBusy('');
    }
  }

  async function remove(source: Source) {
    if (!confirm(`Да премахна ли „${source.name}“ от библиотеката? Изчезва от всички тетрадки.`)) {
      return;
    }
    const before = sources;
    setSources((list) => list.filter((s) => s.id !== source.id));
    try {
      await apiSend(`/api/notebooks/${libraryId}/sources/${source.id}`, 'DELETE');
    } catch (err) {
      setSources(before);
      setError(err instanceof ApiError ? err.message : 'Източникът не беше премахнат.');
    }
  }

  return (
    <>
      {canWrite && (
        <div class="settings-card">
          <div class="settings-section">Добави в библиотеката</div>

          <div class="setting">
            <div class="grow">
              <div class="setting-name">Файлове</div>
              <div class="setting-hint">PDF, Word, текст или аудио — до 25 MB на файл.</div>
            </div>
            <input
              ref={fileInput}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => upload((e.target as HTMLInputElement).files)}
            />
            <button
              class="btn btn-quiet"
              onClick={() => fileInput.current?.click()}
              disabled={busy === 'files'}
            >
              {busy === 'files' ? 'Качвам…' : 'Избери файлове'}
            </button>
          </div>

          <form class="setting" onSubmit={addUrl}>
            <div class="grow">
              <div class="setting-name">Уеб страница или YouTube</div>
              <div class="setting-hint">
                Страница, която се сглобява в браузъра, няма да даде текст — тогава копирай
                съдържанието във файл.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              <input
                class="input"
                type="url"
                placeholder="https://…"
                value={url}
                onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
                style={{ maxWidth: '260px' }}
              />
              <button class="btn btn-quiet" type="submit" disabled={busy === 'url'}>
                {busy === 'url' ? 'Добавям…' : 'Добави'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div class="settings-card">
        <div class="settings-section">
          Източници <span style={{ color: 'var(--faint)', fontWeight: 500 }}>· {sources.length}</span>
        </div>

        {sources.length === 0 && (
          <div class="setting">
            <div class="grow">
              <div class="setting-hint">
                {canWrite
                  ? 'Библиотеката е празна. Качи първия източник отгоре.'
                  : 'Библиотеката е празна. Собственикът още не е качил нищо.'}
              </div>
            </div>
          </div>
        )}

        {sources.map((s) => (
          <div class="setting" key={s.id}>
            <div class="grow">
              <div class="setting-name">
                <span style={{ color: 'var(--faint)', fontWeight: 500 }}>{s.kind}</span> {s.name}
              </div>
              <div class="setting-hint">{statusText(s)}</div>
            </div>
            {canWrite && (
              <button class="btn btn-quiet danger" onClick={() => remove(s)}>
                Премахни
              </button>
            )}
          </div>
        ))}
      </div>

      {error && <div class="banner-error" style={{ margin: '14px 0 0' }}>{error}</div>}
    </>
  );
}

function statusText(s: Source): string {
  if (s.status === 'pending') return 'на ред за обработка…';
  if (s.status === 'indexing') return 'чета и индексирам…';
  if (s.status === 'error') return s.error ?? 'грешка при обработка';
  return s.sub;
}
