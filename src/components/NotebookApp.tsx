import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, api, streamChat, type NotebookState } from '~/lib/client';
import type { AudioFormat, Citation, Message, Note, Source } from '~/lib/types';
import { AddSourceModal } from './AddSourceModal';
import { ChatPanel } from './ChatPanel';
import { Modal } from './Modal';
import { NoteViewer } from './NoteViewer';
import { SourceViewer } from './SourceViewer';
import { SourcesPanel } from './SourcesPanel';
import { StudioPanel } from './StudioPanel';
import { TopBar } from './TopBar';
import { AudioIcon, ChevronRightIcon, FileIcon, SparkIcon } from './icons';

const POLL_INTERVAL_MS = 2500;

export default function NotebookApp({ initialState }: { initialState: NotebookState }) {
  const [state, setState] = useState<NotebookState>(initialState);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initialState.sources.filter((s) => s.status === 'ready').map((s) => s.id)),
  );

  const [addOpen, setAddOpen] = useState(false);
  const [viewSource, setViewSource] = useState<{ source: Source; citation?: Citation | null } | null>(null);
  const [viewNote, setViewNote] = useState<Note | null>(null);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  const [streamingText, setStreamingText] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [artifactBusy, setArtifactBusy] = useState<string | null>(null);
  const [overviewBusy, setOverviewBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [studioOpen, setStudioOpen] = useState(true);
  const [mobileView, setMobileView] = useState<'sources' | 'chat' | 'studio'>('chat');

  const overviewRequested = useRef(state.notebook.description !== null);
  const knownSourceIds = useRef(new Set(initialState.sources.map((s) => s.id)));

  const { notebook, sources, messages, notes, audio } = state;

  const notify = useCallback((message: string) => {
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 4000);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await api.state(notebook.id);
      setState(next);
      return next;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) window.location.href = '/';
      return null;
    }
  }, [notebook.id]);

  /* Newly indexed sources join the selection automatically. */
  useEffect(() => {
    const fresh = sources.filter((s) => !knownSourceIds.current.has(s.id));
    if (!fresh.length) return;
    for (const s of fresh) knownSourceIds.current.add(s.id);
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of fresh) next.add(s.id);
      return next;
    });
  }, [sources]);

  /* Poll while anything is still being worked on in the background. */
  const working =
    sources.some((s) => s.status === 'indexing') ||
    audio.some((a) => a.status === 'scripting' || a.status === 'synthesizing');

  useEffect(() => {
    if (!working) return;
    const timer = setInterval(() => void refresh(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [working, refresh]);

  /* Summarise the notebook once the first source finishes indexing. */
  useEffect(() => {
    if (overviewRequested.current) return;
    if (!sources.some((s) => s.status === 'ready')) return;
    overviewRequested.current = true;
    setOverviewBusy(true);
    api
      .refreshOverview(notebook.id)
      .then((res) => setState((prev) => ({ ...prev, notebook: res.notebook })))
      .catch(() => {
        overviewRequested.current = false;
      })
      .finally(() => setOverviewBusy(false));
  }, [sources, notebook.id]);

  const readySources = useMemo(() => sources.filter((s) => s.status === 'ready'), [sources]);
  const selectedReady = useMemo(
    () => readySources.filter((s) => selected.has(s.id)).map((s) => s.id),
    [readySources, selected],
  );

  /* ------------------------------- handlers ------------------------------- */

  const toggleSource = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = (checked: boolean) =>
    setSelected(checked ? new Set(sources.map((s) => s.id)) : new Set());

  const deleteSource = async (source: Source) => {
    if (!confirm(`Remove “${source.title}” from this notebook?`)) return;
    setState((prev) => ({ ...prev, sources: prev.sources.filter((s) => s.id !== source.id) }));
    try {
      await api.deleteSource(notebook.id, source.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove that source');
    }
    await refresh();
  };

  const send = async (question: string) => {
    setChatError(null);
    setStreamingText('');

    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      notebookId: notebook.id,
      role: 'user',
      content: question,
      citations: [],
      createdAt: Date.now(),
    };
    setState((prev) => ({ ...prev, messages: [...prev.messages, optimistic] }));

    let text = '';
    await streamChat(notebook.id, { message: question, sourceIds: selectedReady }, (event) => {
      if (event.type === 'text') {
        text += event.delta;
        setStreamingText(text);
      } else if (event.type === 'error') {
        setChatError(event.error);
      }
    }).catch((err: unknown) => {
      setChatError(err instanceof Error ? err.message : 'The request failed');
    });

    setStreamingText(null);
    await refresh();
  };

  const clearChat = async () => {
    if (!confirm('Clear this conversation?')) return;
    await api.clearChat(notebook.id).catch(() => {});
    setState((prev) => ({ ...prev, messages: [] }));
    setChatError(null);
  };

  const saveAnswer = async (message: Message) => {
    try {
      await api.createNote(notebook.id, {
        title: firstSentence(message.content),
        content: message.content,
        kind: 'saved_answer',
      });
      await refresh();
      notify('Saved to notes');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not save that note');
    }
  };

  const generateArtifact = async (artifact: string) => {
    setArtifactBusy(artifact);
    try {
      const res = await api.generateArtifact(notebook.id, artifact, selectedReady);
      await refresh();
      setViewNote(res.note);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Generation failed');
    } finally {
      setArtifactBusy(null);
    }
  };

  const createAudio = async (format: AudioFormat, focus: string) => {
    try {
      await api.createAudio(notebook.id, { format, focus, sourceIds: selectedReady });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not start the audio overview');
    }
  };

  const openCitation = (citation: Citation) => {
    const source = citation.sourceId ? sources.find((s) => s.id === citation.sourceId) : undefined;
    if (source) {
      setViewSource({ source, citation });
    } else {
      // The chunk could not be traced to a row (e.g. the source was removed).
      notify(`Cited “${citation.sourceTitle}” is no longer in this notebook`);
    }
  };

  /* -------------------------------- layout -------------------------------- */

  const gridTemplate = `${sourcesOpen ? '19rem' : '3.5rem'} minmax(0,1fr) ${
    studioOpen ? '23rem' : '3.5rem'
  }`;

  const showOnMobile = (view: typeof mobileView) =>
    mobileView === view ? 'flex' : 'hidden md:flex';

  return (
    <div className="flex h-[100dvh] flex-col bg-canvas">
      <TopBar
        notebook={notebook}
        sourceCount={sources.length}
        onRename={async (title) => {
          setState((prev) => ({ ...prev, notebook: { ...prev.notebook, title } }));
          await api.renameNotebook(notebook.id, { title }).catch(() => {});
        }}
      />

      <main
        className="app-grid grid min-h-0 flex-1 gap-2.5 p-2.5 md:gap-3 md:p-3"
        style={{ ['--cols' as string]: gridTemplate }}
      >
        <div className={`${showOnMobile('sources')} min-h-0 flex-col`}>
          {sourcesOpen ? (
            <SourcesPanel
              sources={sources}
              selected={selected}
              onToggle={toggleSource}
              onToggleAll={toggleAll}
              onAdd={() => setAddOpen(true)}
              onOpen={(source) => setViewSource({ source })}
              onDelete={deleteSource}
              onCollapse={() => setSourcesOpen(false)}
            />
          ) : (
            <Rail
              label="Sources"
              Icon={FileIcon}
              badge={sources.length}
              onExpand={() => setSourcesOpen(true)}
            />
          )}
        </div>

        <div className={`${showOnMobile('chat')} min-h-0 flex-col`}>
          <ChatPanel
            notebook={notebook}
            sources={sources}
            selectedCount={selectedReady.length}
            messages={messages}
            streamingText={streamingText}
            busy={streamingText !== null}
            error={chatError}
            onSend={send}
            onCitation={openCitation}
            onSaveAnswer={saveAnswer}
            onClearChat={clearChat}
            onRefreshOverview={() => {
              setOverviewBusy(true);
              api
                .refreshOverview(notebook.id)
                .then((res) => setState((prev) => ({ ...prev, notebook: res.notebook })))
                .catch((err: unknown) =>
                  notify(err instanceof Error ? err.message : 'Could not refresh the summary'),
                )
                .finally(() => setOverviewBusy(false));
            }}
            overviewBusy={overviewBusy}
          />
        </div>

        <div className={`${showOnMobile('studio')} min-h-0 flex-col`}>
          {studioOpen ? (
            <StudioPanel
              notebookId={notebook.id}
              notes={notes}
              audio={audio}
              selectedCount={selectedReady.length}
              artifactBusy={artifactBusy}
              onGenerateArtifact={generateArtifact}
              onCreateAudio={createAudio}
              onDeleteAudio={async (id) => {
                await api.deleteAudio(notebook.id, id).catch(() => {});
                await refresh();
              }}
              onOpenNote={setViewNote}
              onDeleteNote={async (note) => {
                await api.deleteNote(notebook.id, note.id).catch(() => {});
                await refresh();
              }}
              onNewNote={() => setNewNoteOpen(true)}
              onCollapse={() => setStudioOpen(false)}
            />
          ) : (
            <Rail
              label="Studio"
              Icon={AudioIcon}
              badge={notes.length}
              onExpand={() => setStudioOpen(true)}
            />
          )}
        </div>
      </main>

      <nav className="flex shrink-0 border-t border-line bg-surface md:hidden" aria-label="Panels">
        {(
          [
            ['sources', 'Sources', FileIcon],
            ['chat', 'Chat', SparkIcon],
            ['studio', 'Studio', AudioIcon],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setMobileView(key)}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[0.65rem] ${
              mobileView === key ? 'text-accent' : 'text-faint'
            }`}
            aria-current={mobileView === key}
          >
            <Icon className="size-5" />
            {label}
          </button>
        ))}
      </nav>

      {addOpen && (
        <AddSourceModal
          onClose={() => setAddOpen(false)}
          onFiles={async (files) => {
            await api.addFiles(notebook.id, files);
            await refresh();
          }}
          onUrl={async (url) => {
            await api.addUrl(notebook.id, url);
            await refresh();
          }}
          onText={async (text, title) => {
            await api.addText(notebook.id, text, title || undefined);
            await refresh();
          }}
        />
      )}

      {viewSource && (
        <SourceViewer
          notebookId={notebook.id}
          source={viewSource.source}
          citation={viewSource.citation}
          onClose={() => setViewSource(null)}
        />
      )}

      {viewNote && (
        <NoteViewer
          note={viewNote}
          onClose={() => setViewNote(null)}
          onSave={async (patch) => {
            await api.updateNote(notebook.id, viewNote.id, patch);
            const next = await refresh();
            setViewNote(next?.notes.find((n) => n.id === viewNote.id) ?? null);
          }}
          onDelete={async () => {
            await api.deleteNote(notebook.id, viewNote.id).catch(() => {});
            setViewNote(null);
            await refresh();
          }}
        />
      )}

      {newNoteOpen && (
        <NewNoteModal
          onClose={() => setNewNoteOpen(false)}
          onCreate={async (title, content) => {
            await api.createNote(notebook.id, { title, content, kind: 'note' });
            await refresh();
          }}
        />
      )}

      {toast && (
        <div
          role="status"
          className="fixed bottom-20 left-1/2 z-60 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-xs text-canvas shadow-lg md:bottom-6"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function Rail({
  label,
  Icon,
  badge,
  onExpand,
}: {
  label: string;
  Icon: typeof FileIcon;
  badge: number;
  onExpand: () => void;
}) {
  return (
    <div className="panel h-full items-center py-3">
      <button className="btn-icon" onClick={onExpand} title={`Expand ${label.toLowerCase()}`} aria-label={`Expand ${label}`}>
        <ChevronRightIcon className="rotate-180" />
      </button>
      <button
        className="btn-icon mt-2 relative"
        onClick={onExpand}
        aria-label={`${label} (${badge})`}
        title={`${label} (${badge})`}
      >
        <Icon />
        {badge > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-accent text-[0.6rem] text-accent-ink">
            {badge}
          </span>
        )}
      </button>
      <span
        className="mt-3 text-xs tracking-wide text-faint"
        style={{ writingMode: 'vertical-rl' }}
      >
        {label}
      </span>
    </div>
  );
}

function NewNoteModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (title: string, content: string) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!content.trim()) return;
    setSaving(true);
    try {
      await onCreate(title.trim() || firstSentence(content), content.trim());
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      title="New note"
      onClose={onClose}
      footer={
        <>
          <button className="btn-outline" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={saving || !content.trim()}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title (optional)"
          className="field"
          aria-label="Note title"
          autoFocus
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={12}
          placeholder="Write anything. Markdown is supported."
          className="field resize-y"
          aria-label="Note content"
        />
      </div>
    </Modal>
  );
}

function firstSentence(text: string): string {
  const clean = text.replace(/[#*`>_[\]]/g, '').replace(/\s+/g, ' ').trim();
  const stop = clean.search(/[.!?]\s/);
  return (stop > 12 ? clean.slice(0, stop + 1) : clean).slice(0, 80) || 'Note';
}
