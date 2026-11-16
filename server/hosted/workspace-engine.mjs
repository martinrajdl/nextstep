import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openStore } from '../store.mjs';
import { AppError } from '../errors.mjs';

// Only application entities cross this boundary. Desktop paths, preferences,
// compatibility imports, credentials and folder-sync configuration never do.
export const workspaceTables = Object.freeze({
  crm_meta: 'id',
  crm_collections: 'id',
  crm_records: 'id',
  crm_views: 'id',
  crm_changes: 'id',
  crm_events: 'id',
  crm_flows: 'id',
  crm_flow_updates: 'id',
  crm_policy: 'id',
  crm_note_library: 'id',
  crm_note_documents: 'note_id',
  crm_note_sync: 'note_id',
});
export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
export const MAX_WORKSPACE_ROWS = 50000;
export const canonical = (value) => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item);
export const fingerprint = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export const entityKey = ({ table, id }) => `${table}:${id}`;

export function readWorkspaceRows(db) {
  return Object.entries(workspaceTables).flatMap(([table, key]) =>
    db.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all().map((data) =>
      ({ table, id: String(data[key]), data: { ...data } })));
}

export function openWorkspaceEngine(rows = []) {
  if (!Array.isArray(rows) || rows.length > MAX_WORKSPACE_ROWS || Buffer.byteLength(JSON.stringify(rows)) > MAX_WORKSPACE_BYTES)
    throw new AppError('This workspace exceeds the hosted adapter capacity.', 413);
  const db = new DatabaseSync(':memory:');
  let store;
  try {
    store = openStore(':memory:', { connection: db });
    const seen = new Set();
    db.exec('PRAGMA foreign_keys=OFF; BEGIN');
    if (rows.length) {
      for (const table of Object.keys(workspaceTables)) db.exec(`DELETE FROM ${table}`);
      for (const entry of rows) {
        const key = Object.hasOwn(workspaceTables, entry?.table) && workspaceTables[entry.table];
        if (!key || !entry.data || typeof entry.data !== 'object' || Array.isArray(entry.data) || String(entry.data[key]) !== entry.id || seen.has(entityKey(entry)))
          throw new AppError('Invalid workspace entity.');
        seen.add(entityKey(entry));
        const columns = db.prepare(`PRAGMA table_info(${entry.table})`).all().map((column) => column.name);
        if (Object.keys(entry.data).length !== columns.length || columns.some((column) => !Object.hasOwn(entry.data, column)))
          throw new AppError('Unsupported workspace entity version.');
        db.prepare(`INSERT INTO ${entry.table} (${columns.join(',')}) VALUES (${columns.map(() => '?').join(',')})`)
          .run(...columns.map((column) => entry.data[column]));
      }
    }
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new AppError('Workspace references could not be preserved.');
    if (db.prepare('SELECT version FROM crm_meta WHERE id=1').get()?.version !== 3 || !db.prepare('SELECT 1 FROM crm_policy WHERE id=1').get())
      throw new AppError('Unsupported workspace version.');
    db.exec('COMMIT; PRAGMA foreign_keys=ON');
    return { crm: store.crm, rows: () => readWorkspaceRows(db), close: () => store.close() };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function diffWorkspaceRows(before, after) {
  if (after.length > MAX_WORKSPACE_ROWS || Buffer.byteLength(JSON.stringify(after)) > MAX_WORKSPACE_BYTES)
    throw new AppError('This workspace exceeds the hosted adapter capacity.', 413);
  const old = new Map(before.map((row) => [entityKey(row), row]));
  const next = new Set(after.map(entityKey));
  return {
    upserts: after.filter((row) => canonical(old.get(entityKey(row))?.data) !== canonical(row.data)),
    deletions: before.filter((row) => !next.has(entityKey(row))),
  };
}
