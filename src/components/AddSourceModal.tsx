import { useRef, useState } from 'react';
import { MAX_SOURCE_BYTES } from '~/lib/constants';
import { Modal } from './Modal';
import { AlertIcon, LinkIcon, TextIcon, UploadIcon, YouTubeIcon } from './icons';

type Tab = 'upload' | 'link' | 'text';

interface Props {
  onClose: () => void;
  onFiles: (files: File[]) => Promise<void>;
  onUrl: (url: string) => Promise<void>;
  onText: (text: string, title: string) => Promise<void>;
}

const ACCEPT = '.pdf,.txt,.md,.markdown,.csv,.json,.docx,.html,.htm,.rtf';

export function AddSourceModal({ onClose, onFiles, onUrl, onText }: Props) {
  const [tab, setTab] = useState<Tab>('upload');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const submitFiles = (files: File[]) => {
    const usable = files.filter((f) => f.size > 0);
    if (!usable.length) return;
    const tooBig = usable.find((f) => f.size > MAX_SOURCE_BYTES);
    if (tooBig) {
      setError(`"${tooBig.name}" is larger than ${MAX_SOURCE_BYTES / 1024 / 1024} MB.`);
      return;
    }
    void run(() => onFiles(usable));
  };

  const tabs: Array<{ key: Tab; label: string; Icon: typeof UploadIcon }> = [
    { key: 'upload', label: 'Upload', Icon: UploadIcon },
    { key: 'link', label: 'Link', Icon: LinkIcon },
    { key: 'text', label: 'Paste text', Icon: TextIcon },
  ];

  return (
    <Modal title="Add sources" onClose={onClose}>
      <p className="mb-4 text-sm text-muted">
        Sources ground every answer in this notebook. Add documents, links or notes and everything
        the assistant says will cite them.
      </p>

      <div className="mb-4 flex gap-1 rounded-full bg-raised p-1">
        {tabs.map(({ key, label, Icon }) => (
          <button
            key={key}
            onClick={() => {
              setTab(key);
              setError(null);
            }}
            className={`btn h-9 flex-1 text-xs ${
              tab === key ? 'bg-canvas text-ink shadow-sm' : 'text-muted hover:text-ink'
            }`}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      {tab === 'upload' && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            submitFiles([...e.dataTransfer.files]);
          }}
          className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft/30' : 'border-line'
          }`}
        >
          <div className="grid size-12 place-items-center rounded-2xl bg-raised text-muted">
            <UploadIcon className="size-6" />
          </div>
          <p className="text-sm text-ink">Drag and drop files here</p>
          <p className="text-xs text-faint">
            PDF, DOCX, TXT, Markdown, CSV, JSON · up to {MAX_SOURCE_BYTES / 1024 / 1024} MB each
          </p>
          <button className="btn-tonal" onClick={() => fileInput.current?.click()} disabled={busy}>
            Choose files
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              submitFiles([...(e.target.files ?? [])]);
              e.target.value = '';
            }}
          />
        </div>
      )}

      {tab === 'link' && (
        <div className="space-y-3">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && url.trim() && run(() => onUrl(url.trim()))}
            placeholder="https://example.com/article"
            className="field"
            aria-label="Website or YouTube URL"
            autoFocus
          />
          <p className="flex items-center gap-1.5 text-xs text-faint">
            <YouTubeIcon className="size-4" />
            YouTube links are transcribed automatically before indexing.
          </p>
          <button
            className="btn-primary w-full"
            disabled={busy || !url.trim()}
            onClick={() => run(() => onUrl(url.trim()))}
          >
            {busy ? 'Fetching…' : 'Add link'}
          </button>
        </div>
      )}

      {tab === 'text' && (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Title (optional)"
            className="field"
            aria-label="Source title"
          />
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={9}
            placeholder="Paste or type your text here…"
            className="field resize-y"
            aria-label="Source text"
            autoFocus
          />
          <button
            className="btn-primary w-full"
            disabled={busy || text.trim().length < 20}
            onClick={() => run(() => onText(text.trim(), title.trim()))}
          >
            {busy ? 'Adding…' : 'Add text'}
          </button>
        </div>
      )}

      {busy && tab === 'upload' && (
        <p className="mt-4 text-center text-xs text-muted">Uploading…</p>
      )}

      {error && (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-danger-soft px-3 py-2.5 text-xs text-danger">
          <AlertIcon className="mt-px size-4 shrink-0" />
          {error}
        </p>
      )}
    </Modal>
  );
}
