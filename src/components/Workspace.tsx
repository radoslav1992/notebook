import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiError, apiGet, apiSend, apiStream } from '~/lib/client';
import { MAX_SOURCES_PER_NOTEBOOK } from '~/lib/constants';
import type { StudioTaskKey } from '~/lib/prompts';
import AddSourceModal from './AddSourceModal';
import ChatPanel from './ChatPanel';
import MindmapModal from './MindmapModal';
import SourcesPanel from './SourcesPanel';
import StudioPanel from './StudioPanel';
import type { Citation, Message, Mindmap, Note, Notebook, Source, StudioJob } from '~/lib/types';

type Tab = 'sources' | 'chat' | 'studio';

interface Props {
  notebook: Notebook;
  sources: Source[];
  messages: Message[];
  notes: Note[];
  audioJob: StudioJob | null;
  mindmap: Mindmap | null;
  model: string;
  openAddOnMount: boolean;
}

export default function Workspace(props: Props) {
  const [notebook, setNotebook] = useState(props.notebook);
  const [sources, setSources] = useState(props.sources);
  const [messages, setMessages] = useState(props.messages);
  const [notes, setNotes] = useState(props.notes);
  const [audioJob, setAudioJob] = useState(props.audioJob);
  const [mindmap, setMindmap] = useState(props.mindmap);

  const [tab, setTab] = useState<Tab>('chat');
  const [addOpen, setAddOpen] = useState(props.openAddOnMount);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapError, setMapError] = useState('');
  const [busyTask, setBusyTask] = useState<StudioTaskKey | null>(null);
  const [streaming, setStreaming] = useState<string | null>(null);
  const [thinking, setThinking] = useState(false);
  const [chatError, setChatError] = useState('');
  const [quotaHit, setQuotaHit] = useState(false);
  const [openCitation, setOpenCitation] = useState<Citation | null>(null);

  const abort = useRef<AbortController | null>(null);

  const ready = useMemo(() => sources.filter((s) => s.status === 'ready'), [sources]);
  const selected = useMemo(() => ready.filter((s) => s.selected), [ready]);
  const pending = useMemo(
    () => sources.some((s) => s.status === 'pending' || s.status === 'indexing'),
    [sources],
  );

  /* ── Опресняване, докато източници се обработват ─────────────────────── */

  const refreshSources = useCallback(async () => {
    try {
      const { sources: fresh } = await apiGet<{ sources: Source[] }>(
        `/api/notebooks/${notebook.id}/sources`,
      );
      setSources(fresh);
      // Заглавието и емоджито се измислят от съдържанието след първия източник.
      if (notebook.title === 'Нова тетрадка') {
        const { notebook: nb } = await apiGet<{ notebook: Notebook }>(
          `/api/notebooks/${notebook.id}`,
        );
        setNotebook(nb);
        document.title = `${nb.title} — Записки`;
      }
      return fresh;
    } catch {
      return null;
    }
  }, [notebook.id, notebook.title]);

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refreshSources(), 2500);
    return () => clearInterval(timer);
  }, [pending, refreshSources]);

  /* ── Опресняване, докато се прави аудио ─────────────────────────────── */

  useEffect(() => {
    if (!audioJob || (audioJob.status !== 'queued' && audioJob.status !== 'running')) return;
    const id = audioJob.id;
    const timer = setInterval(async () => {
      try {
        const { job } = await apiGet<{ job: StudioJob }>(
          `/api/notebooks/${notebook.id}/jobs/${id}`,
        );
        setAudioJob(job);
      } catch {
        /* следващият тик ще опита пак */
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [audioJob?.id, audioJob?.status, notebook.id]);

  /* ── Източници ───────────────────────────────────────────────────────── */

  async function toggleSource(source: Source) {
    const next = !source.selected;
    setSources((list) => list.map((s) => (s.id === source.id ? { ...s, selected: next } : s)));
    try {
      await apiSend(`/api/notebooks/${notebook.id}/sources/${source.id}`, 'PATCH', {
        selected: next,
      });
    } catch {
      setSources((list) =>
        list.map((s) => (s.id === source.id ? { ...s, selected: source.selected } : s)),
      );
    }
  }

  async function toggleAll(next: boolean) {
    const before = sources;
    setSources((list) => list.map((s) => ({ ...s, selected: next })));
    try {
      await apiSend(`/api/notebooks/${notebook.id}/sources/select`, 'POST', { selected: next });
    } catch {
      setSources(before);
    }
  }

  async function removeSource(source: Source) {
    if (!confirm(`Да премахна ли „${source.name}“ от тетрадката?`)) return;
    const before = sources;
    setSources((list) => list.filter((s) => s.id !== source.id));
    try {
      await apiSend(`/api/notebooks/${notebook.id}/sources/${source.id}`, 'DELETE');
    } catch (err) {
      setSources(before);
      setChatError(err instanceof ApiError ? err.message : 'Премахването се провали.');
    }
  }

  /* ── Чат ─────────────────────────────────────────────────────────────── */

  /** 402 идва от лимит на плана — тогава показваме път напред. */
  function reportError(err: unknown, fallback: string) {
    if (err instanceof ApiError && err.status === 402) setQuotaHit(true);
    setChatError(err instanceof ApiError ? err.message : fallback);
  }

  async function ask(question: string) {
    setChatError('');
    setQuotaHit(false);
    setThinking(true);
    setStreaming(null);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;

    let buffer = '';
    try {
      await apiStream(
        `/api/notebooks/${notebook.id}/chat`,
        { question },
        (event, data) => {
          if (event === 'user') {
            setMessages((list) => [...list, data.message as Message]);
          } else if (event === 'delta') {
            buffer += String(data.text ?? '');
            setThinking(false);
            setStreaming(buffer);
          } else if (event === 'done') {
            setStreaming(null);
            setThinking(false);
            setMessages((list) => [...list, data.message as Message]);
          } else if (event === 'error') {
            setChatError(String(data.error ?? 'Нещо се обърка.'));
            setStreaming(null);
            setThinking(false);
          }
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        reportError(err, 'Отговорът не стигна до тук.');
      }
    } finally {
      setThinking(false);
      setStreaming(null);
    }
  }

  /* ── Студио ──────────────────────────────────────────────────────────── */

  async function generateAudio() {
    setChatError('');
    try {
      const { job } = await apiSend<{ job: StudioJob }>(
        `/api/notebooks/${notebook.id}/audio`,
        'POST',
        { minutes: 8 },
      );
      setAudioJob(job);
      setTab('studio');
    } catch (err) {
      reportError(err, 'Аудиото не беше пуснато.');
    }
  }

  async function generateNote(task: StudioTaskKey) {
    setBusyTask(task);
    setChatError('');
    try {
      const { note } = await apiSend<{ note: Note }>(
        `/api/notebooks/${notebook.id}/notes`,
        'POST',
        { task },
      );
      setNotes((list) => [note, ...list]);
    } catch (err) {
      reportError(err, 'Материалът не беше създаден.');
    } finally {
      setBusyTask(null);
    }
  }

  async function addNote() {
    const title = prompt('Заглавие на бележката:', 'Нова бележка');
    if (title === null) return;
    try {
      const { note } = await apiSend<{ note: Note }>(
        `/api/notebooks/${notebook.id}/notes`,
        'POST',
        { title: title.trim() || 'Нова бележка', body: '' },
      );
      setNotes((list) => [note, ...list]);
    } catch (err) {
      setChatError(err instanceof ApiError ? err.message : 'Бележката не беше запазена.');
    }
  }

  async function deleteNote(note: Note) {
    const before = notes;
    setNotes((list) => list.filter((n) => n.id !== note.id));
    try {
      await apiSend(`/api/notebooks/${notebook.id}/notes/${note.id}`, 'DELETE');
    } catch {
      setNotes(before);
    }
  }

  async function generateMindmap() {
    setMapBusy(true);
    setMapError('');
    try {
      const { mindmap: map } = await apiSend<{ mindmap: Mindmap }>(
        `/api/notebooks/${notebook.id}/mindmap`,
        'POST',
      );
      setMindmap(map);
    } catch (err) {
      setMapError(err instanceof ApiError ? err.message : 'Картата не беше направена.');
    } finally {
      setMapBusy(false);
    }
  }

  const canGenerate = selected.length > 0;

  return (
    <>
      <div class="mobile-tabs">
        {(
          [
            ['sources', 'Източници'],
            ['chat', 'Чат'],
            ['studio', 'Студио'],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button key={key} class={tab === key ? 'on' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div class={`workspace ${tab === 'studio' ? 'show-studio' : ''}`}>
        <SourcesPanel
          sources={sources}
          active={tab === 'sources'}
          onToggle={toggleSource}
          onToggleAll={toggleAll}
          onRemove={removeSource}
          onAdd={() => setAddOpen(true)}
          notebookId={notebook.id}
          onLibraryChange={refreshSources}
        />

        <ChatPanel
          notebook={notebook}
          messages={messages}
          streaming={streaming}
          thinking={thinking}
          error={chatError}
          quotaHit={quotaHit}
          model={props.model}
          selectedCount={selected.length}
          totalCount={sources.length}
          onAsk={ask}
          onCitation={setOpenCitation}
          active={tab === 'chat'}
        />

        <StudioPanel
          notes={notes}
          audioJob={audioJob}
          busyTask={busyTask}
          canGenerate={canGenerate}
          onGenerateAudio={generateAudio}
          onGenerateNote={generateNote}
          onAddNote={addNote}
          onDeleteNote={deleteNote}
          onOpenMindmap={() => setMapOpen(true)}
          active={tab === 'studio'}
        />
      </div>

      {addOpen && (
        <AddSourceModal
          notebookId={notebook.id}
          remaining={MAX_SOURCES_PER_NOTEBOOK - sources.length}
          onClose={() => setAddOpen(false)}
          onAdded={(created) => {
            setSources((list) => [...list, ...created]);
            setTab('sources');
          }}
        />
      )}

      {mapOpen && (
        <MindmapModal
          mindmap={mindmap}
          busy={mapBusy}
          error={mapError}
          canGenerate={canGenerate}
          onGenerate={generateMindmap}
          onPickNode={(label) => {
            setMapOpen(false);
            setTab('chat');
            void ask(`Какво казват източниците за „${label}“?`);
          }}
          onClose={() => setMapOpen(false)}
        />
      )}

      {openCitation && (
        <CitationModal citation={openCitation} onClose={() => setOpenCitation(null)} />
      )}
    </>
  );
}

/* ── Изгледът на един цитат ──────────────────────────────────────────────── */

function CitationModal({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  return (
    <div class="overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Препратка">
      <div class="modal" style={{ width: '560px' }} onClick={(e) => e.stopPropagation()}>
        <div class="modal-head">
          <div class="grow">
            <h2 class="modal-title">Препратка</h2>
            <p class="modal-sub">{citation.label}</p>
          </div>
          <button class="modal-x" onClick={onClose} aria-label="Затвори">
            ×
          </button>
        </div>
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--line-soft)',
            borderRadius: 'var(--r-lg)',
            padding: '16px',
            fontSize: '13.5px',
            lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            color: 'var(--ink)',
          }}
        >
          {citation.snippet || 'Пасажът не беше запазен.'}
        </div>
        <div class="modal-actions">
          <div class="grow" />
          <button class="btn btn-primary confirm" onClick={onClose}>
            Затвори
          </button>
        </div>
      </div>
    </div>
  );
}
