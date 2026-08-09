import { useEffect, useRef, useState } from 'react';
import type { Notebook } from '~/lib/types';
import { ThemeToggle } from './ThemeToggle';
import { ChevronLeftIcon, NotebookIcon } from './icons';

interface Props {
  notebook: Notebook;
  sourceCount: number;
  onRename: (title: string) => Promise<void>;
}

export function TopBar({ notebook, sourceCount, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(notebook.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(notebook.title), [notebook.title]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const title = draft.trim();
    if (title && title !== notebook.title) void onRename(title);
    else setDraft(notebook.title);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 px-3 md:px-4">
      <a href="/" className="btn-icon" title="All notebooks" aria-label="Back to all notebooks">
        <ChevronLeftIcon />
      </a>

      <span className="hidden text-lg sm:block" aria-hidden>
        {notebook.emoji}
      </span>

      {editing ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setDraft(notebook.title);
              setEditing(false);
            }
          }}
          className="min-w-0 flex-1 rounded-lg border border-accent bg-elevated px-2 py-1 text-base font-medium outline-none"
          aria-label="Notebook title"
        />
      ) : (
        <button
          className="min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-base font-medium hover:bg-hover"
          onClick={() => setEditing(true)}
          title="Rename notebook"
        >
          {notebook.title}
        </button>
      )}

      <span className="hidden shrink-0 text-xs text-faint sm:block">
        {sourceCount} source{sourceCount === 1 ? '' : 's'}
      </span>

      <ThemeToggle />

      <a href="/" className="btn-icon hidden sm:inline-flex" title="All notebooks" aria-label="All notebooks">
        <NotebookIcon />
      </a>
    </header>
  );
}
