export type SourceKind = 'PDF' | 'DOC' | 'WEB' | 'YT' | 'TXT' | 'AUD';
export type SourceStatus = 'pending' | 'indexing' | 'ready' | 'error';
export type NoteKind = 'note' | 'study_guide' | 'timeline' | 'briefing' | 'exam';
export type JobKind = 'audio' | 'mindmap' | 'note';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface User {
  id: string;
  displayName: string;
  initials: string;
}

export interface Notebook {
  id: string;
  emoji: string;
  title: string;
  blurb: string;
  storeName: string | null;
  createdAt: number;
  updatedAt: number;
  /** Попълва се от заявките за списък/детайл. */
  sourceCount?: number;
  meta?: string;
}

export interface Source {
  id: string;
  notebookId: string;
  ordinal: number;
  kind: SourceKind;
  name: string;
  sub: string;
  originUrl: string | null;
  r2Key: string | null;
  byteSize: number;
  pageCount: number;
  charCount: number;
  selected: boolean;
  status: SourceStatus;
  error: string | null;
  docName: string | null;
  createdAt: number;
}

export interface Citation {
  ordinal: number;
  sourceId: string | null;
  label: string;
  locator: string;
  snippet: string;
}

export interface Message {
  id: string;
  role: 'user' | 'ai';
  text: string;
  createdAt: number;
  citations: Citation[];
}

export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  body: string;
  createdAt: number;
}

export interface StudioJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  step: string;
  progress: number;
  durationS: number;
  error: string | null;
  audioUrl?: string;
  result?: unknown;
}

export interface MindmapNode {
  label: string;
  hint?: string;
}

export interface Mindmap {
  center: string;
  nodes: MindmapNode[];
}

/** Един извлечен, готов за вграждане пасаж от източник. */
export interface Passage {
  text: string;
  /** Номер на страница / раздел, ако е известен. */
  page?: number;
  /** Човешки четимо място: „стр. 12“, „34:12“, „раздел 2“. */
  locator: string;
}

/** Резултат от извличането на текст от източник. */
export interface Extraction {
  passages: Passage[];
  pageCount: number;
  /** Заглавие, открито в самия документ — ползва се, ако няма подадено име. */
  title?: string;
}

export interface Settings {
  responseLanguage: string;
  offlineMode: boolean;
  chatModel: string;
}
