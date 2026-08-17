import { useEffect, useRef, useState } from 'preact/hooks';
import { formatDuration } from '~/lib/audio/wav';
import { renderMarkdown } from '~/lib/markdown';
import { STUDIO_TASKS, tilesFor, type StudioTaskKey, type UseCase } from '~/lib/prompts';
import type { Note, StudioJob } from '~/lib/types';

interface Props {
  notes: Note[];
  audioJob: StudioJob | null;
  busyTask: StudioTaskKey | null;
  canGenerate: boolean;
  onGenerateAudio: () => void;
  onGenerateNote: (task: StudioTaskKey) => void;
  onAddNote: () => void;
  onDeleteNote: (note: Note) => void;
  onOpenMindmap: () => void;
  /** За какво се ползва приложението — решава кои материали се предлагат. */
  useCase: string;
  active: boolean;
}

export default function StudioPanel({
  notes,
  audioJob,
  busyTask,
  canGenerate,
  onGenerateAudio,
  onGenerateNote,
  onAddNote,
  onDeleteNote,
  onOpenMindmap,
  useCase,
  active,
}: Props) {
  return (
    <section class={`panel studio ${active ? 'active' : ''}`} aria-label="Студио">
      <div class="studio-head">
        <h2 class="panel-title">Студио</h2>
        <span class="panel-count">
          {notes.length} {notes.length === 1 ? 'материал' : 'материала'}
        </span>
      </div>

      <div class="studio-body">
        <AudioCard job={audioJob} canGenerate={canGenerate} onGenerate={onGenerateAudio} />

        <button class="studio-card studio-clickable plain" onClick={onOpenMindmap}>
          <div class="studio-card-title" style={{ marginBottom: '5px' }}>
            Мисловна карта
          </div>
          <div class="studio-card-body">
            Виж как се свързват темите в източниците. Кликни възел, за да го отвориш в чата.
          </div>
        </button>

        <div class="studio-grid">
          {tilesFor(useCase as UseCase).map((task) => (
            <button
              key={task}
              class="studio-tile"
              onClick={() => onGenerateNote(task)}
              disabled={!canGenerate || busyTask !== null}
              title={canGenerate ? '' : 'Избери поне един обработен източник'}
            >
              {busyTask === task && <span class="spinner" />}
              {STUDIO_TASKS[task].title}
            </button>
          ))}
        </div>

        <div class="studio-label">
          <span>Бележки</span>
          <button onClick={onAddNote}>+ Нова</button>
        </div>

        {notes.length === 0 && (
          <div class="studio-card-body" style={{ padding: '0 2px 8px' }}>
            Още няма бележки. Направи материал отгоре или добави своя.
          </div>
        )}

        {notes.map((note) => (
          <NoteCard key={note.id} note={note} onDelete={() => onDeleteNote(note)} />
        ))}
      </div>
    </section>
  );
}

/* ── Аудио преглед ───────────────────────────────────────────────────────── */

function AudioCard({
  job,
  canGenerate,
  onGenerate,
}: {
  job: StudioJob | null;
  canGenerate: boolean;
  onGenerate: () => void;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const running = job?.status === 'queued' || job?.status === 'running';
  const ready = job?.status === 'done' && Boolean(job.audioUrl);
  const total = job?.durationS ?? 0;

  // Нов запис → нов елемент; спираме стария, за да не звучат двата.
  useEffect(() => {
    setPlaying(false);
    setElapsed(0);
    if (audio.current) {
      audio.current.pause();
      audio.current.currentTime = 0;
    }
  }, [job?.audioUrl]);

  function toggle() {
    const el = audio.current;
    if (!el) return;
    if (el.paused) {
      void el.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      el.pause();
      setPlaying(false);
    }
  }

  function seek(event: MouseEvent) {
    const el = audio.current;
    if (!el || !total) return;
    const bar = event.currentTarget as HTMLDivElement;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    el.currentTime = ratio * (Number.isFinite(el.duration) && el.duration > 0 ? el.duration : total);
  }

  const progress = total > 0 ? `${Math.min(100, (elapsed / total) * 100)}%` : '0%';

  return (
    <div class="studio-card">
      <div class="studio-card-head">
        <div class="studio-card-title">Аудио преглед</div>
        {ready && <div class="studio-card-note">{formatDuration(total)}</div>}
      </div>
      <div class="studio-card-body">
        Двама водещи обсъждат източниците ти на разговорен български.
      </div>

      {running && (
        <div class="audio-progress">
          <span class="spinner" />
          <span>{job?.step || 'Подготвям…'}</span>
          <span style={{ marginLeft: 'auto', color: 'var(--faint)' }}>{job?.progress ?? 0}%</span>
        </div>
      )}

      {job?.status === 'error' && (
        <div class="banner-error" style={{ margin: '12px 0 0' }}>
          {job.error ?? 'Генерирането се провали.'}
        </div>
      )}

      {ready ? (
        <div class="audio-row">
          <audio
            ref={audio}
            src={job!.audioUrl}
            preload="metadata"
            onTimeUpdate={(e) => setElapsed((e.currentTarget as HTMLAudioElement).currentTime)}
            onEnded={() => {
              setPlaying(false);
              setElapsed(0);
            }}
          />
          <button class="play" onClick={toggle} aria-label={playing ? 'Пауза' : 'Пусни'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <div class="audio-track">
            <div class="track" onClick={seek} role="presentation">
              <div class="track-fill" style={{ width: progress }} />
            </div>
            <div class="track-times">
              <span>{formatDuration(elapsed)}</span>
              <span>{formatDuration(total)}</span>
            </div>
          </div>
        </div>
      ) : (
        !running && (
          <div style={{ marginTop: '13px' }}>
            <button
              class="btn btn-primary"
              style={{ fontSize: '12.5px', padding: '9px 16px' }}
              onClick={onGenerate}
              disabled={!canGenerate}
              title={canGenerate ? '' : 'Избери поне един обработен източник'}
            >
              {job?.status === 'error' ? 'Опитай пак' : 'Създай аудио преглед'}
            </button>
          </div>
        )
      )}
    </div>
  );
}

/* ── Бележка ─────────────────────────────────────────────────────────────── */

function NoteCard({ note, onDelete }: { note: Note; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const body = useRef<HTMLDivElement>(null);

  // Дължината в знаци не казва дали текстът е отрязан — заглавия и списъци
  // заемат различна височина. Мерим самия елемент.
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setClipped(el.scrollHeight > el.clientHeight + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [note.body]);

  return (
    <div class="note">
      <button class="note-del" onClick={onDelete} aria-label={`Изтрий „${note.title}“`}>
        ×
      </button>
      <div class="note-title">{note.title}</div>
      <div
        ref={body}
        class={`note-body md ${open ? 'open' : ''}`}
        dangerouslySetInnerHTML={{ __html: renderMarkdown(note.body) }}
      />
      {(clipped || open) && (
        <button class="note-more" onClick={() => setOpen(!open)}>
          {open ? 'Скрий' : 'Покажи цялото'}
        </button>
      )}
    </div>
  );
}
