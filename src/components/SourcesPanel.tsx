import { useEffect, useState } from 'preact/hooks';
import { apiGet, apiSend } from '~/lib/client';
import type { Source } from '~/lib/types';

interface LibrarySource {
  id: string;
  name: string;
  kind: string;
  sub: string;
  on: boolean;
}

interface Library {
  orgId: string;
  orgName: string;
  role: string;
  sources: LibrarySource[];
}

interface Props {
  sources: Source[];
  notebookId: string;
  onToggle: (source: Source) => void;
  onToggleAll: (selected: boolean) => void;
  onRemove: (source: Source) => void;
  onAdd: () => void;
  onLibraryChange: () => void;
  active: boolean;
}

export default function SourcesPanel({
  sources,
  notebookId,
  onToggle,
  onToggleAll,
  onRemove,
  onAdd,
  onLibraryChange,
  active,
}: Props) {
  const allSelected = sources.length > 0 && sources.every((s) => s.selected);
  const [libraries, setLibraries] = useState<Library[]>([]);

  // Общите източници се теглят отделно: тетрадка без организация не бива да
  // плаща за заявка, която винаги връща празно, затова секцията просто не се
  // показва, ако няма нищо.
  useEffect(() => {
    apiGet<{ libraries: Library[] }>(`/api/notebooks/${notebookId}/library`)
      .then((r) => setLibraries(r.libraries.filter((l) => l.sources.length > 0)))
      .catch(() => setLibraries([]));
  }, [notebookId]);

  async function toggleShared(lib: Library, source: LibrarySource) {
    const next = !source.on;
    setLibraries((list) =>
      list.map((l) =>
        l.orgId === lib.orgId
          ? { ...l, sources: l.sources.map((s) => (s.id === source.id ? { ...s, on: next } : s)) }
          : l,
      ),
    );
    try {
      await apiSend(`/api/notebooks/${notebookId}/library`, 'PATCH', {
        sourceId: source.id,
        on: next,
      });
      // Отговорите се смятат по разрешените източници, тоест списъкът в
      // работната площ трябва да се опресни, иначе цитатите сочат номера, които
      // интерфейсът още не познава.
      onLibraryChange();
    } catch {
      setLibraries((list) =>
        list.map((l) =>
          l.orgId === lib.orgId
            ? { ...l, sources: l.sources.map((s) => (s.id === source.id ? { ...s, on: !next } : s)) }
            : l,
        ),
      );
    }
  }

  return (
    <section class={`panel sources ${active ? 'active' : ''}`} aria-label="Източници">
      <div class="panel-head">
        <div class="panel-row">
          <h2 class="panel-title">Източници</h2>
          <span class="panel-count">{sources.length}</span>
        </div>
        <button class="add-source" onClick={onAdd}>
          + Добави източник
        </button>
      </div>

      <div class="src-list">
        {sources.length > 0 && (
          <button class="select-all" onClick={() => onToggleAll(!allSelected)}>
            {allSelected ? 'Изчисти избора' : 'Избери всички'}
          </button>
        )}

        {sources.length === 0 && (
          <p class="src-hint">
            Тетрадката е празна. Добави PDF, Word, уеб страница, YouTube, аудио или собствен текст —
            до 50 източника.
          </p>
        )}

        {libraries.map((lib) => (
          <div class="src-shared" key={lib.orgId}>
            <div class="src-shared-head">{lib.orgName} · общи</div>
            {lib.sources.map((s) => (
              <button
                key={s.id}
                class="src-item"
                onClick={() => toggleShared(lib, s)}
                title={s.name}
              >
                <span class="src-kind">{s.kind}</span>
                <span class="src-body">
                  <span class="src-name">{s.name}</span>
                  <span class="src-sub">{s.sub}</span>
                </span>
                <span class={`check ${s.on ? 'on' : ''}`} aria-hidden="true">
                  {s.on ? '✓' : ''}
                </span>
              </button>
            ))}
          </div>
        ))}

        {sources.map((s) => (
          <button
            key={s.id}
            class={`src-item ${s.status === 'error' ? 'is-error' : ''}`}
            onClick={() => onToggle(s)}
            disabled={s.status !== 'ready'}
            title={s.status === 'error' ? (s.error ?? 'Грешка') : s.name}
          >
            <span class="src-kind">{s.kind}</span>
            <span class="src-body">
              <span class="src-name">{s.name}</span>
              <span class="src-sub">
                {(s.status === 'pending' || s.status === 'indexing') && <span class="spinner" />}
                {statusText(s)}
              </span>
            </span>
            <span
              class="src-remove"
              role="button"
              tabIndex={-1}
              aria-label={`Премахни ${s.name}`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(s);
              }}
            >
              ×
            </span>
            {s.status === 'ready' && (
              <span class={`check ${s.selected ? 'on' : ''}`} aria-hidden="true">
                {s.selected ? '✓' : ''}
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function statusText(s: Source): string {
  if (s.status === 'pending') return 'на ред за обработка…';
  if (s.status === 'indexing') return 'чета и индексирам…';
  if (s.status === 'error') return s.error ? shorten(s.error) : 'грешка при обработка';
  return s.sub;
}

function shorten(text: string, max = 70): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
