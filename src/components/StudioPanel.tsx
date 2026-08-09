import { useState } from 'react';
import { formatDuration, relativeTime } from '~/lib/client';
import type { AudioFormat, AudioOverview, Note } from '~/lib/types';
import {
  AudioIcon,
  BriefIcon,
  ChevronRightIcon,
  DownloadIcon,
  FaqIcon,
  MindMapIcon,
  NoteIcon,
  PlusIcon,
  SparkIcon,
  StudyIcon,
  TimelineIcon,
  TrashIcon,
} from './icons';

interface Props {
  notebookId: string;
  notes: Note[];
  audio: AudioOverview[];
  selectedCount: number;
  artifactBusy: string | null;
  onGenerateArtifact: (artifact: string) => void;
  onCreateAudio: (format: AudioFormat, focus: string) => void;
  onDeleteAudio: (id: string) => void;
  onOpenNote: (note: Note) => void;
  onDeleteNote: (note: Note) => void;
  onNewNote: () => void;
  onCollapse: () => void;
}

const ARTIFACT_BUTTONS = [
  { key: 'study_guide', label: 'Study guide', Icon: StudyIcon },
  { key: 'briefing', label: 'Briefing doc', Icon: BriefIcon },
  { key: 'faq', label: 'FAQ', Icon: FaqIcon },
  { key: 'timeline', label: 'Timeline', Icon: TimelineIcon },
  { key: 'mindmap', label: 'Mind map', Icon: MindMapIcon },
] as const;

const AUDIO_FORMATS: Array<{ key: AudioFormat; label: string; hint: string }> = [
  { key: 'deep_dive', label: 'Deep dive', hint: 'Two hosts, ~6 min' },
  { key: 'brief', label: 'Brief', hint: 'One narrator, ~2 min' },
  { key: 'debate', label: 'Debate', hint: 'Two opposing views' },
  { key: 'critique', label: 'Critique', hint: 'Two experts review' },
];

const NOTE_ICONS: Record<string, typeof NoteIcon> = {
  study_guide: StudyIcon,
  briefing: BriefIcon,
  faq: FaqIcon,
  timeline: TimelineIcon,
  mindmap: MindMapIcon,
  saved_answer: SparkIcon,
  note: NoteIcon,
};

export function StudioPanel({
  notebookId,
  notes,
  audio,
  selectedCount,
  artifactBusy,
  onGenerateArtifact,
  onCreateAudio,
  onDeleteAudio,
  onOpenNote,
  onDeleteNote,
  onNewNote,
  onCollapse,
}: Props) {
  const disabled = selectedCount === 0;

  return (
    <section className="panel h-full" aria-label="Studio">
      <header className="panel-header">
        <h2 className="text-base font-medium">Studio</h2>
        <button className="btn-icon" onClick={onCollapse} title="Collapse studio" aria-label="Collapse studio panel">
          <ChevronRightIcon />
        </button>
      </header>

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 pb-5">
        <AudioSection
          notebookId={notebookId}
          audio={audio}
          disabled={disabled}
          onCreate={onCreateAudio}
          onDelete={onDeleteAudio}
        />

        <div>
          <div className="mb-2 flex items-center justify-between px-1">
            <h3 className="text-sm font-medium">Notes</h3>
            <button className="btn-ghost px-2" onClick={onNewNote} title="Write a note">
              <PlusIcon className="size-4" />
              Add
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {ARTIFACT_BUTTONS.map(({ key, label, Icon }) => (
              <button
                key={key}
                className="card flex items-center gap-2 px-3 py-2.5 text-left text-xs text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-45"
                onClick={() => onGenerateArtifact(key)}
                disabled={disabled || artifactBusy !== null}
                title={disabled ? 'Select at least one source' : `Generate a ${label.toLowerCase()}`}
              >
                {artifactBusy === key ? (
                  <span className="size-4 shrink-0 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
                ) : (
                  <Icon className="size-4 shrink-0 text-muted" />
                )}
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          {notes.length === 0 ? (
            <div className="mt-4 flex flex-col items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-8 text-center">
              <NoteIcon className="size-6 text-faint" />
              <p className="text-xs text-muted">
                Saved notes and generated documents land here.
              </p>
            </div>
          ) : (
            <ul className="mt-4 space-y-1.5">
              {notes.map((note) => {
                const Icon = NOTE_ICONS[note.kind] ?? NoteIcon;
                return (
                  <li key={note.id} className="group relative">
                    <button
                      className="card w-full px-3 py-2.5 pr-10 text-left transition-colors hover:bg-hover"
                      onClick={() => onOpenNote(note)}
                    >
                      <span className="flex items-center gap-2">
                        <Icon className="size-4 shrink-0 text-muted" />
                        <span className="truncate text-sm">{note.title}</span>
                      </span>
                      <span className="mt-1 block truncate text-xs text-faint">
                        {relativeTime(note.createdAt)}
                      </span>
                    </button>
                    <button
                      className="btn-icon absolute right-1.5 top-1.5 size-8 opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
                      onClick={() => onDeleteNote(note)}
                      title="Delete note"
                      aria-label={`Delete ${note.title}`}
                    >
                      <TrashIcon className="size-4" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function AudioSection({
  notebookId,
  audio,
  disabled,
  onCreate,
  onDelete,
}: {
  notebookId: string;
  audio: AudioOverview[];
  disabled: boolean;
  onCreate: (format: AudioFormat, focus: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<AudioFormat>('deep_dive');
  const [focus, setFocus] = useState('');

  const pending = audio.find((a) => a.status === 'scripting' || a.status === 'synthesizing');
  const latest = audio[0];

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-ink">
          <AudioIcon className="size-4.5" />
        </span>
        <div className="min-w-0">
          <h3 className="text-sm font-medium">Audio Overview</h3>
          <p className="truncate text-xs text-faint">Turn your sources into a conversation</p>
        </div>
      </div>

      {pending ? (
        <div className="mt-4 flex items-center gap-2.5 rounded-xl bg-raised px-3 py-2.5 text-xs text-muted">
          <span className="size-4 shrink-0 animate-spin-slow rounded-full border-2 border-line border-t-accent" />
          {pending.status === 'scripting'
            ? 'Writing the script…'
            : 'Recording the conversation…'}
        </div>
      ) : (
        <>
          {open && (
            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                {AUDIO_FORMATS.map((option) => (
                  <button
                    key={option.key}
                    onClick={() => setFormat(option.key)}
                    className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                      format === option.key
                        ? 'border-accent bg-accent-soft text-accent-soft-ink'
                        : 'border-line hover:bg-hover'
                    }`}
                  >
                    <span className="block text-xs font-medium">{option.label}</span>
                    <span className="block text-[0.65rem] opacity-70">{option.hint}</span>
                  </button>
                ))}
              </div>
              <textarea
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                rows={2}
                placeholder="Optional: what should the hosts focus on?"
                className="field resize-none text-xs"
                aria-label="Audio focus"
              />
            </div>
          )}

          <div className="mt-4 flex gap-2">
            <button
              className="btn-primary h-9 flex-1 px-3 text-xs"
              disabled={disabled}
              onClick={() => onCreate(format, focus)}
              title={disabled ? 'Select at least one source' : 'Generate an audio overview'}
            >
              Generate
            </button>
            <button
              className="btn-outline h-9 px-3 text-xs"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
            >
              {open ? 'Hide' : 'Customize'}
            </button>
          </div>
        </>
      )}

      {latest && latest.status === 'ready' && (
        <div className="mt-4 rounded-xl bg-raised p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted">
              {AUDIO_FORMATS.find((f) => f.key === latest.format)?.label ?? 'Audio'}
              {latest.durationMs ? ` · ${formatDuration(latest.durationMs)}` : ''}
            </span>
            <span className="flex shrink-0 gap-0.5">
              <a
                className="btn-icon size-7"
                href={`/api/notebooks/${notebookId}/audio/${latest.id}`}
                download={`audio-overview-${latest.id}.wav`}
                title="Download"
                aria-label="Download audio overview"
              >
                <DownloadIcon className="size-4" />
              </a>
              <button
                className="btn-icon size-7"
                onClick={() => onDelete(latest.id)}
                title="Delete"
                aria-label="Delete audio overview"
              >
                <TrashIcon className="size-4" />
              </button>
            </span>
          </div>
          <audio
            controls
            preload="metadata"
            className="w-full"
            src={`/api/notebooks/${notebookId}/audio/${latest.id}`}
          />
        </div>
      )}

      {latest && latest.status === 'error' && (
        <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-danger">
          {latest.error ?? 'Audio generation failed.'}{' '}
          <button className="underline" onClick={() => onDelete(latest.id)}>
            Dismiss
          </button>
        </p>
      )}
    </div>
  );
}
