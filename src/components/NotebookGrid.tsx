import { useState } from 'react';
import { api, relativeTime } from '~/lib/client';
import type { Notebook } from '~/lib/types';
import { ThemeToggle } from './ThemeToggle';
import { NotebookIcon, PlusIcon, SparkIcon, TrashIcon } from './icons';

type Card = Notebook & { sourceCount: number };

export default function NotebookGrid({ initial }: { initial: Card[] }) {
  const [notebooks, setNotebooks] = useState(initial);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setCreating(true);
    setError(null);
    try {
      const { notebook } = await api.createNotebook();
      window.location.href = `/notebook/${notebook.id}`;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a notebook');
      setCreating(false);
    }
  };

  const remove = async (notebook: Card) => {
    if (!confirm(`Delete “${notebook.title}” and everything in it?`)) return;
    setNotebooks((prev) => prev.filter((n) => n.id !== notebook.id));
    await api.deleteNotebook(notebook.id).catch(() => {});
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mb-10 flex items-start justify-between gap-4">
        <div>
          <p className="mb-1 flex items-center gap-2 text-sm text-faint">
            <NotebookIcon className="size-4" />
            Notebook
          </p>
          <h1 className="text-3xl font-medium tracking-tight sm:text-4xl">
            Your sources, understood
          </h1>
          <p className="mt-2 max-w-xl text-sm text-muted">
            Upload documents, links and notes. Ask questions and get answers grounded in what you
            gave it — with citations, study guides and audio overviews.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <div className="mb-6 flex items-center justify-between gap-3">
        <h2 className="text-lg font-medium">
          {notebooks.length ? `${notebooks.length} notebook${notebooks.length === 1 ? '' : 's'}` : ''}
        </h2>
        <button className="btn-primary" onClick={create} disabled={creating}>
          <PlusIcon className="size-4.5" />
          {creating ? 'Creating…' : 'Create new'}
        </button>
      </div>

      {error && (
        <p className="mb-6 rounded-2xl bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      )}

      {notebooks.length === 0 ? (
        <button
          onClick={create}
          disabled={creating}
          className="flex w-full flex-col items-center gap-4 rounded-3xl border-2 border-dashed border-line px-6 py-20 text-center transition-colors hover:bg-hover"
        >
          <span className="grid size-16 place-items-center rounded-3xl bg-raised text-faint">
            <SparkIcon className="size-7" />
          </span>
          <span className="text-lg font-medium">Create your first notebook</span>
          <span className="max-w-sm text-sm text-muted">
            Add a few sources and start asking questions about them.
          </span>
        </button>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notebooks.map((notebook) => (
            <li key={notebook.id} className="group relative">
              <a
                href={`/notebook/${notebook.id}`}
                className="card flex h-full flex-col gap-3 p-5 transition-colors hover:bg-hover"
              >
                <span className="text-3xl" aria-hidden>
                  {notebook.emoji}
                </span>
                <span className="line-clamp-2 text-base font-medium leading-snug">
                  {notebook.title}
                </span>
                <span className="mt-auto text-xs text-faint">
                  {relativeTime(notebook.updatedAt)} · {notebook.sourceCount} source
                  {notebook.sourceCount === 1 ? '' : 's'}
                </span>
              </a>
              <button
                className="btn-icon absolute right-2 top-2 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                onClick={() => remove(notebook)}
                title="Delete notebook"
                aria-label={`Delete ${notebook.title}`}
              >
                <TrashIcon className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
