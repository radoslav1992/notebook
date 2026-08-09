import { useEffect, useMemo, useState } from 'react';
import { api, formatBytes } from '~/lib/client';
import type { Citation, Source } from '~/lib/types';
import { Modal } from './Modal';
import { sourceIcon } from './SourcesPanel';
import { LinkIcon } from './icons';

interface Props {
  notebookId: string;
  source: Source;
  /** When opened from a citation, scroll to and highlight the cited passage. */
  citation?: Citation | null;
  onClose: () => void;
}

export function SourceViewer({ notebookId, source, citation, onClose }: Props) {
  const [text, setText] = useState<string | null>(source.preview);
  const [loading, setLoading] = useState(source.preview === null);
  const Glyph = sourceIcon(source);

  useEffect(() => {
    if (source.preview !== null) {
      setText(source.preview);
      return;
    }
    let cancelled = false;
    setLoading(true);
    api
      .getSource(notebookId, source.id)
      .then((res) => {
        if (!cancelled) setText(res.source.preview);
      })
      .catch(() => {
        if (!cancelled) setText(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [notebookId, source.id, source.preview]);

  const segments = useMemo(() => highlight(text, citation?.quote ?? null), [text, citation?.quote]);

  useEffect(() => {
    if (!citation) return;
    // Let the modal paint before scrolling to the marked passage.
    const timer = setTimeout(() => {
      document.getElementById('cited-passage')?.scrollIntoView({ block: 'center' });
    }, 60);
    return () => clearTimeout(timer);
  }, [citation, segments]);

  return (
    <Modal title={source.title} onClose={onClose} size="wide">
      <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-faint">
        <span className="chip cursor-default">
          <Glyph className="size-3.5" />
          {source.kind === 'youtube'
            ? 'YouTube'
            : source.kind === 'url'
              ? 'Web page'
              : source.kind === 'text'
                ? 'Pasted text'
                : (source.mimeType?.split('/').pop()?.toUpperCase() ?? 'File')}
        </span>
        {source.sizeBytes > 0 && <span>{formatBytes(source.sizeBytes)}</span>}
        {source.originUrl && (
          <a
            className="chip"
            href={source.originUrl}
            target="_blank"
            rel="noreferrer noopener"
            title={source.originUrl}
          >
            <LinkIcon className="size-3.5" />
            Open original
          </a>
        )}
      </div>

      {source.summary && (
        <div className="mb-4 rounded-2xl bg-raised px-4 py-3">
          <p className="text-sm leading-6 text-muted">{source.summary}</p>
          {source.topics.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {source.topics.map((topic) => (
                <span
                  key={topic}
                  className="rounded-full bg-canvas px-2.5 py-1 text-[0.7rem] text-muted"
                >
                  {topic}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {citation && (
        <div className="mb-4 rounded-2xl border border-accent bg-accent-soft/40 px-4 py-3">
          <p className="mb-1 text-[0.7rem] font-medium uppercase tracking-wide text-accent">
            Cited passage {citation.index}
          </p>
          <p className="text-sm leading-6 text-ink">{citation.quote}</p>
        </div>
      )}

      {loading ? (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="skeleton h-3.5 rounded" style={{ width: `${70 + (i % 4) * 8}%` }} />
          ))}
        </div>
      ) : text ? (
        <div className="whitespace-pre-wrap font-mono text-[0.8125rem] leading-6 text-muted">
          {segments}
        </div>
      ) : (
        <p className="rounded-2xl border border-dashed border-line px-4 py-8 text-center text-sm text-faint">
          No text preview available for this file. It is still fully indexed and searchable — the
          cited passages above come straight from it.
        </p>
      )}
    </Modal>
  );
}

/** Splits the document text around the cited quote so it can be marked. */
function highlight(text: string | null, quote: string | null) {
  if (!text) return null;
  if (!quote) return text;

  const needle = normalise(quote);
  const haystack = normalise(text);
  let at = haystack.indexOf(needle);

  // Long retrieved chunks rarely match verbatim; fall back to a distinctive slice.
  if (at === -1 && needle.length > 120) {
    at = haystack.indexOf(needle.slice(0, 120));
  }
  if (at === -1) return text;

  const end = Math.min(at + needle.length, text.length);
  return (
    <>
      {text.slice(0, at)}
      <mark
        id="cited-passage"
        className="rounded bg-accent-soft px-0.5 text-accent-soft-ink"
      >
        {text.slice(at, end)}
      </mark>
      {text.slice(end)}
    </>
  );
}

/** Whitespace-insensitive comparison without shifting character offsets. */
function normalise(value: string): string {
  return value.replace(/\s/g, ' ');
}
