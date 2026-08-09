import { useMemo, useState } from 'react';
import { formatBytes } from '~/lib/client';
import type { Source } from '~/lib/types';
import {
  AlertIcon,
  ChevronLeftIcon,
  FileIcon,
  LinkIcon,
  PdfIcon,
  PlusIcon,
  SearchIcon,
  TextIcon,
  TrashIcon,
  YouTubeIcon,
} from './icons';

interface Props {
  sources: Source[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  onAdd: () => void;
  onOpen: (source: Source) => void;
  onDelete: (source: Source) => void;
  onCollapse: () => void;
}

export function sourceIcon(source: Source) {
  if (source.kind === 'youtube') return YouTubeIcon;
  if (source.kind === 'url') return LinkIcon;
  if (source.kind === 'text') return TextIcon;
  if (source.mimeType === 'application/pdf') return PdfIcon;
  return FileIcon;
}

export function SourcesPanel({
  sources,
  selected,
  onToggle,
  onToggleAll,
  onAdd,
  onOpen,
  onDelete,
  onCollapse,
}: Props) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter(
      (s) => s.title.toLowerCase().includes(q) || (s.summary ?? '').toLowerCase().includes(q),
    );
  }, [sources, query]);

  const allSelected = sources.length > 0 && sources.every((s) => selected.has(s.id));

  return (
    <section className="panel h-full" aria-label="Sources">
      <header className="panel-header">
        <h2 className="text-base font-medium">Sources</h2>
        <button className="btn-icon" onClick={onCollapse} title="Collapse sources" aria-label="Collapse sources panel">
          <ChevronLeftIcon />
        </button>
      </header>

      <div className="px-3 pb-3 shrink-0">
        <button className="btn-outline w-full" onClick={onAdd}>
          <PlusIcon className="size-4.5" />
          Add source
        </button>
      </div>

      {sources.length > 3 && (
        <div className="px-3 pb-2 shrink-0">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sources"
              className="field pl-9 py-2"
              aria-label="Search sources"
            />
          </div>
        </div>
      )}

      {sources.length > 0 && (
        <div className="flex items-center justify-between px-4 pb-2 shrink-0">
          <span className="text-xs text-faint">
            {selected.size} of {sources.length} selected
          </span>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
            Select all
            <input
              type="checkbox"
              checked={allSelected}
              onChange={(e) => onToggleAll(e.target.checked)}
              className="size-4 accent-[var(--c-accent)]"
            />
          </label>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sources.length === 0 ? (
          <EmptySources onAdd={onAdd} />
        ) : filtered.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-faint">No sources match “{query}”.</p>
        ) : (
          <ul className="space-y-0.5">
            {filtered.map((source) => (
              <SourceRow
                key={source.id}
                source={source}
                checked={selected.has(source.id)}
                onToggle={() => onToggle(source.id)}
                onOpen={() => onOpen(source)}
                onDelete={() => onDelete(source)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function SourceRow({
  source,
  checked,
  onToggle,
  onOpen,
  onDelete,
}: {
  source: Source;
  checked: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const Glyph = sourceIcon(source);
  const indexing = source.status === 'indexing';
  const failed = source.status === 'error';

  return (
    <li className="group relative flex items-center gap-2 rounded-xl px-2 py-1.5 transition-colors hover:bg-hover">
      <input
        type="checkbox"
        checked={checked}
        disabled={source.status !== 'ready'}
        onChange={onToggle}
        aria-label={`Use ${source.title} in this notebook`}
        className="size-4 shrink-0 accent-[var(--c-accent)] disabled:opacity-40"
      />

      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
        title={source.title}
      >
        <span
          className={`shrink-0 ${failed ? 'text-danger' : indexing ? 'text-faint' : 'text-muted'}`}
        >
          {failed ? <AlertIcon className="size-4.5" /> : <Glyph className="size-4.5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-ink">{source.title}</span>
          <span className="block truncate text-xs text-faint">
            {indexing
              ? 'Indexing…'
              : failed
                ? (source.error ?? 'Failed to index')
                : (source.summary ?? formatBytes(source.sizeBytes) ?? '')}
          </span>
        </span>
      </button>

      {indexing && (
        <span
          className="size-3.5 shrink-0 animate-spin-slow rounded-full border-2 border-line border-t-accent"
          aria-label="Indexing"
        />
      )}

      <button
        className="btn-icon absolute right-1.5 size-8 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 bg-surface"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        title="Remove source"
        aria-label={`Remove ${source.title}`}
      >
        <TrashIcon className="size-4" />
      </button>
    </li>
  );
}

function EmptySources({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-10 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-raised text-faint">
        <FileIcon className="size-6" />
      </div>
      <p className="text-sm text-muted">
        Saved sources will appear here.
        <br />
        Add PDFs, documents, pasted text or links.
      </p>
      <button className="btn-tonal" onClick={onAdd}>
        <PlusIcon className="size-4.5" />
        Add a source
      </button>
    </div>
  );
}
