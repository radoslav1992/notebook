import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { parseOverview } from '~/lib/client';
import type { Citation, Message, Notebook, Source } from '~/lib/types';
import { Markdown } from './Markdown';
import { AlertIcon, CopyIcon, NoteIcon, RefreshIcon, SendIcon, SparkIcon, TrashIcon } from './icons';

interface Props {
  notebook: Notebook;
  sources: Source[];
  selectedCount: number;
  messages: Message[];
  streamingText: string | null;
  busy: boolean;
  error: string | null;
  onSend: (question: string) => void;
  onCitation: (citation: Citation) => void;
  onSaveAnswer: (message: Message) => void;
  onClearChat: () => void;
  onRefreshOverview: () => void;
  overviewBusy: boolean;
}

export function ChatPanel({
  notebook,
  sources,
  selectedCount,
  messages,
  streamingText,
  busy,
  error,
  onSend,
  onCitation,
  onSaveAnswer,
  onClearChat,
  onRefreshOverview,
  overviewBusy,
}: Props) {
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const ready = sources.filter((s) => s.status === 'ready');
  const canChat = ready.length > 0 && selectedCount > 0 && !busy;
  const overview = parseOverview(notebook.description);

  // Keep the newest turn in view as tokens stream in.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, streamingText]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [draft]);

  const submit = () => {
    const question = draft.trim();
    if (!question || !canChat) return;
    setDraft('');
    onSend(question);
  };

  return (
    <section className="panel h-full" aria-label="Chat">
      <header className="panel-header border-b border-line">
        <h2 className="text-base font-medium">Chat</h2>
        {messages.length > 0 && (
          <button className="btn-ghost" onClick={onClearChat} title="Clear the conversation">
            <TrashIcon className="size-4" />
            <span className="hidden sm:inline">Clear</span>
          </button>
        )}
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
          {messages.length === 0 && !streamingText ? (
            <EmptyChat
              notebook={notebook}
              sourceCount={ready.length}
              overview={overview}
              onAsk={(q) => canChat && onSend(q)}
              onRefreshOverview={onRefreshOverview}
              overviewBusy={overviewBusy}
            />
          ) : (
            <div className="space-y-6">
              {messages.map((message) => (
                <Turn
                  key={message.id}
                  message={message}
                  onCitation={onCitation}
                  onSave={() => onSaveAnswer(message)}
                />
              ))}
              {streamingText !== null && <StreamingTurn text={streamingText} />}
            </div>
          )}

          {error && (
            <div className="mt-6 flex items-start gap-2.5 rounded-2xl border border-line bg-danger-soft px-4 py-3 text-sm text-danger">
              <AlertIcon className="mt-0.5 size-4.5 shrink-0" />
              <p>{error}</p>
            </div>
          )}
        </div>
      </div>

      <footer className="shrink-0 border-t border-line p-3 sm:p-4">
        <div className="mx-auto w-full max-w-3xl">
          <div className="flex items-end gap-2 rounded-3xl border border-line bg-elevated px-3 py-2 focus-within:border-accent transition-colors">
            <textarea
              ref={textareaRef}
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder={
                ready.length === 0
                  ? 'Add a source to get started'
                  : selectedCount === 0
                    ? 'Select at least one source'
                    : 'Ask anything about your sources…'
              }
              disabled={ready.length === 0}
              aria-label="Ask a question about your sources"
              className="max-h-45 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-sm text-ink outline-none placeholder:text-faint disabled:cursor-not-allowed"
            />
            <span className="hidden shrink-0 pb-1.5 text-xs text-faint sm:block">
              {selectedCount} source{selectedCount === 1 ? '' : 's'}
            </span>
            <button
              className="btn size-9 shrink-0 rounded-full bg-accent text-accent-ink hover:opacity-90"
              onClick={submit}
              disabled={!canChat || !draft.trim()}
              aria-label="Send"
              title="Send"
            >
              {busy ? (
                <span className="size-4 animate-spin-slow rounded-full border-2 border-current border-t-transparent" />
              ) : (
                <SendIcon className="size-5" />
              )}
            </button>
          </div>
          <p className="mt-2 text-center text-[0.7rem] text-faint">
            Answers are grounded in your sources. Check citations before relying on them.
          </p>
        </div>
      </footer>
    </section>
  );
}

function Turn({
  message,
  onCitation,
  onSave,
}: {
  message: Message;
  onCitation: (citation: Citation) => void;
  onSave: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (message.role === 'user') {
    return (
      <div className="flex justify-end animate-fade-up">
        <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-lg bg-accent-soft px-4 py-2.5 text-[0.9375rem] leading-6 text-accent-soft-ink">
          {message.content}
        </p>
      </div>
    );
  }

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <article className="animate-fade-up">
      <Markdown
        text={message.content}
        onCitation={(index) => {
          const citation = message.citations.find((c) => c.index === index);
          if (citation) onCitation(citation);
        }}
      />

      {message.citations.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {message.citations.map((citation) => (
            <button
              key={citation.index}
              className="chip max-w-full"
              onClick={() => onCitation(citation)}
              title={citation.quote.slice(0, 300)}
            >
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-accent-soft text-[0.6rem] font-medium text-accent-soft-ink">
                {citation.index}
              </span>
              <span className="truncate">{citation.sourceTitle}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center gap-1">
        <button className="btn-ghost" onClick={onSave} title="Save this answer as a note">
          <NoteIcon className="size-4" />
          Save to note
        </button>
        <button className="btn-ghost" onClick={copy} title="Copy answer">
          <CopyIcon className="size-4" />
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </article>
  );
}

function StreamingTurn({ text }: { text: string }) {
  if (!text) {
    return (
      <div className="flex items-center gap-2 text-sm text-faint" role="status">
        <span className="size-4 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
        Searching your sources…
      </div>
    );
  }
  return (
    <article>
      <Markdown text={text} />
      <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-accent align-middle" />
    </article>
  );
}

function EmptyChat({
  notebook,
  sourceCount,
  overview,
  onAsk,
  onRefreshOverview,
  overviewBusy,
}: {
  notebook: Notebook;
  sourceCount: number;
  overview: ReturnType<typeof parseOverview>;
  onAsk: (question: string) => void;
  onRefreshOverview: () => void;
  overviewBusy: boolean;
}) {
  if (sourceCount === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-20 text-center">
        <div className="grid size-16 place-items-center rounded-3xl bg-raised text-faint">
          <SparkIcon className="size-7" />
        </div>
        <h3 className="text-xl font-medium">Add a source to get started</h3>
        <p className="max-w-md text-sm text-muted">
          Upload documents, paste text, or drop in a link. Everything you ask will be answered from
          those sources, with citations back to the exact passage.
        </p>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-raised text-2xl">
              {notebook.emoji}
            </span>
            <div>
              <h3 className="text-lg font-medium leading-tight">{notebook.title}</h3>
              <p className="text-xs text-faint">
                {sourceCount} source{sourceCount === 1 ? '' : 's'}
              </p>
            </div>
          </div>
          <button
            className="btn-icon"
            onClick={onRefreshOverview}
            disabled={overviewBusy}
            title="Regenerate summary"
            aria-label="Regenerate notebook summary"
          >
            <RefreshIcon className={`size-4.5 ${overviewBusy ? 'animate-spin-slow' : ''}`} />
          </button>
        </div>

        {overview?.summary ? (
          <p className="mt-4 text-[0.9375rem] leading-7 text-muted">{overview.summary}</p>
        ) : (
          <div className="mt-4 space-y-2" aria-hidden>
            <div className="skeleton h-3.5 w-full rounded" />
            <div className="skeleton h-3.5 w-11/12 rounded" />
            <div className="skeleton h-3.5 w-8/12 rounded" />
          </div>
        )}
      </div>

      {overview?.questions?.length ? (
        <div className="mt-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-faint">
            Suggested questions
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {overview.questions.map((question) => (
              <button
                key={question}
                onClick={() => onAsk(question)}
                className="card px-4 py-3 text-left text-sm text-muted transition-colors hover:bg-hover hover:text-ink"
              >
                {question}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
