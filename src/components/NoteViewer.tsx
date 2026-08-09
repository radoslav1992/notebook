import { useState } from 'react';
import { sanitizeMindMap, type MindMapNode } from '~/lib/studio';
import type { Note } from '~/lib/types';
import { Markdown } from './Markdown';
import { MindMap } from './MindMap';
import { Modal } from './Modal';
import { CopyIcon, SaveIcon, TrashIcon } from './icons';

interface Props {
  note: Note;
  onClose: () => void;
  onSave: (patch: { title: string; content: string }) => Promise<void>;
  onDelete: () => void;
}

export function NoteViewer({ note, onClose, onSave, onDelete }: Props) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [content, setContent] = useState(note.content);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const mindMap: MindMapNode | null =
    note.kind === 'mindmap' ? safeParseMindMap(note.content) : null;

  const save = async () => {
    setSaving(true);
    try {
      await onSave({ title: title.trim() || note.title, content });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(note.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Modal
      title={editing ? 'Edit note' : note.title}
      onClose={onClose}
      size="wide"
      footer={
        <>
          <button className="btn-ghost text-danger" onClick={onDelete}>
            <TrashIcon className="size-4" />
            Delete
          </button>
          <span className="flex-1" />
          {editing ? (
            <>
              <button className="btn-outline" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </button>
              <button className="btn-primary" onClick={save} disabled={saving}>
                <SaveIcon className="size-4" />
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={copy}>
                <CopyIcon className="size-4" />
                {copied ? 'Copied' : 'Copy'}
              </button>
              {!mindMap && (
                <button className="btn-outline" onClick={() => setEditing(true)}>
                  Edit
                </button>
              )}
            </>
          )}
        </>
      }
    >
      {editing ? (
        <div className="space-y-3">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="field"
            aria-label="Note title"
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
            className="field resize-y font-mono text-[0.8125rem] leading-6"
            aria-label="Note content"
          />
        </div>
      ) : mindMap ? (
        <MindMap root={mindMap} />
      ) : (
        <Markdown text={note.content} />
      )}
    </Modal>
  );
}

function safeParseMindMap(raw: string): MindMapNode | null {
  try {
    return sanitizeMindMap(JSON.parse(raw));
  } catch {
    return null;
  }
}
