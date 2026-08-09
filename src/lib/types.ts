export type SourceKind = 'file' | 'text' | 'url' | 'youtube';
export type SourceStatus = 'indexing' | 'ready' | 'error';

export interface Notebook {
  id: string;
  ownerId: string;
  title: string;
  emoji: string;
  description: string | null;
  storeName: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Source {
  id: string;
  notebookId: string;
  title: string;
  kind: SourceKind;
  mimeType: string | null;
  sizeBytes: number;
  originUrl: string | null;
  status: SourceStatus;
  error: string | null;
  summary: string | null;
  topics: string[];
  preview: string | null;
  createdAt: number;
}

/** One inline citation, mapped back to the source it came from. */
export interface Citation {
  /** 1-based marker rendered in the answer, e.g. [3]. */
  index: number;
  sourceId: string | null;
  sourceTitle: string;
  /** The retrieved passage the model actually grounded on. */
  quote: string;
  /** Character offsets into the answer text that this citation supports. */
  startIndex?: number;
  endIndex?: number;
}

export interface Message {
  id: string;
  notebookId: string;
  role: 'user' | 'assistant';
  content: string;
  citations: Citation[];
  createdAt: number;
}

export type NoteKind =
  | 'note'
  | 'study_guide'
  | 'briefing'
  | 'faq'
  | 'timeline'
  | 'mindmap'
  | 'saved_answer';

export interface Note {
  id: string;
  notebookId: string;
  title: string;
  content: string;
  kind: NoteKind;
  createdAt: number;
  updatedAt: number;
}

export type AudioStatus = 'scripting' | 'synthesizing' | 'ready' | 'error';
export type AudioFormat = 'deep_dive' | 'brief' | 'debate' | 'critique';

export interface AudioOverview {
  id: string;
  notebookId: string;
  status: AudioStatus;
  format: AudioFormat;
  focus: string | null;
  script: string | null;
  durationMs: number | null;
  error: string | null;
  createdAt: number;
}
