import { request } from './model';
export type FieldType =
  | 'text'
  | 'longtext'
  | 'number'
  | 'email'
  | 'url'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'multiselect'
  | 'relation';
export type Field = {
  key: string;
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  options?: string[];
  collection?: string;
};
export type Filter = {
  field: string;
  op: 'eq' | 'contains' | 'empty' | 'not_empty' | 'gte' | 'lte';
  value?: string | number | boolean;
};
export type Sort = { field: string; direction: 'asc' | 'desc' };
export type View = {
  id: string;
  collectionId: string;
  name: string;
  layout: 'table' | 'board';
  groupBy: string;
  columns: string[];
  filters: Filter[];
  sort: Sort;
  version: number;
};
export type Collection = {
  id: string;
  name: string;
  description: string;
  color: string;
  fields: Field[];
  version: number;
  recordCount: number;
  views: View[];
};
export type Template = Pick<
  Collection,
  'id' | 'name' | 'description' | 'color' | 'fields'
>;
export type Value = string | number | boolean | string[] | null;
export type RecordItem = {
  id: string;
  collectionId: string;
  title: string;
  values: Record<string, Value>;
  externalKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};
export type Operation = Record<string, unknown> & { type: string };
export type Diff = {
  action: string;
  entityType: string;
  entityId: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
};
export type Change = {
  id: string;
  title: string;
  summary: string;
  actor: string;
  operations: Operation[];
  status: 'pending' | 'approved' | 'rejected' | 'applied';
  result: Diff[];
  version: number;
  createdAt: string;
  reviewedAt: string | null;
};
export type Event = Diff & {
  id: number;
  changeId: string;
  actor: string;
  createdAt: string;
};
export type Workspace = {
  existingWorkspaces?: { id: string; name: string; path: string }[];
  recentFlows: AgentFlow[];
  collections: Collection[];
  templates: Template[];
  pendingCount: number;
  recordCount: number;
  fieldTypes: FieldType[];
  connection: object;
};
export type FlowStage =
  | 'sourcing'
  | 'shaping'
  | 'review'
  | 'updating'
  | 'complete'
  | 'blocked';
export type AgentFlow = {
  id: string;
  goal: string;
  actor: string;
  stage: FlowStage;
  message: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  pendingCount: number;
  appliedCount: number;
  sources?: { label: string; url: string }[];
  changes: {
    id: string;
    title: string;
    status: Change['status'];
    operationCount: number;
  }[];
  updates?: {
    reportId: string;
    stage: FlowStage;
    message: string;
    actor: string;
    createdAt: string;
    sources: { label: string; url: string }[];
  }[];
};
export type PageResult = {
  records: RecordItem[];
  total: number;
  offset: number;
  nextOffset: number | null;
};
export const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64);
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'Could not save. Please try again.';
export const newChange = (
  title: string,
  operations: Operation[],
  summary = '',
) => ({ id: crypto.randomUUID(), title, summary, operations, actor: 'You' });
export const applyChange = (title: string, operations: Operation[]) =>
  request<Change>('/api/crm/apply', 'POST', newChange(title, operations));
export const queryRecords = (input: object) =>
  request<PageResult>('/api/crm/query', 'POST', input);
export function displayValue(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint')
    return value.toString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  return JSON.stringify(value) ?? '—';
}
export const dateTime = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
