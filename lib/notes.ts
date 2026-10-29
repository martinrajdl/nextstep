import type { RecordItem } from './crm';
export type Note = RecordItem & {
  body: string;
  pinned: boolean;
  state: 'active' | 'archived' | 'trash';
  links: string[];
  tags: string[];
  conflictOf: string | null;
};
export type NoteSummary = Omit<Note, 'body'> & { preview: string };
export type NotesPage = {
  notes: NoteSummary[];
  total: number;
  tags: string[];
  libraryId: string | null;
};
export type NotesSync = {
  available: boolean;
  enabled: boolean;
  folder: string | null;
  missingCount?: number;
  pending: number;
  state: string;
  message: string;
  lastSyncedAt: string | null;
};
