import { DatabaseSync } from 'node:sqlite';
import { AppError } from '../errors.mjs';
import { workspaceTables, openWorkspaceEngine, fingerprint, readWorkspaceRows } from './workspace-engine.mjs';

const parse = (value) => JSON.parse(value);
export function selectWorkspaceRows(sourceRows, { collectionIds = [], noteIds = [] } = {}) {
  if (!Array.isArray(collectionIds) || !Array.isArray(noteIds) || !collectionIds.length)
    throw new AppError('Select the collections and notes to transfer explicitly.');
  const collections = new Set(collectionIds), notes = new Set(noteIds);
  const source = (table) => sourceRows.filter((row) => row.table === table);
  const library = source('crm_note_library')[0];
  if (notes.size && library) collections.add(library.data.collection_id);
  for (const id of collections) if (!source('crm_collections').some((row) => row.id === id)) throw new AppError('A selected collection does not exist.');
  for (const id of notes) if (!source('crm_note_documents').some((row) => row.id === id)) throw new AppError('A selected note does not exist.');
  const records = new Set(source('crm_records').filter((row) =>
    (collections.has(row.data.collection_id) && row.data.collection_id !== library?.data.collection_id) || notes.has(row.id)).map((row) => row.id));
  const views = new Set(source('crm_views').filter((row) => collections.has(row.data.collection_id) && row.data.collection_id !== library?.data.collection_id).map((row) => row.id));
  const identities = new Set([...collections,...records,...views]);
  for (const event of source('crm_events').filter((row) => row.data.entity_type === 'view')) {
    const snapshot = parse(event.data.after_data || event.data.before_data || 'null');
    if (collections.has(snapshot?.collectionId)) identities.add(event.data.entity_id);
  }
  const events = source('crm_events').filter((row) => identities.has(row.data.entity_id));
  const operationSelected = (op) => op.type === 'create_collection' || op.type === 'update_collection'
    ? collections.has(op.id)
    : ['create_record','create_view'].includes(op.type) ? collections.has(op.collectionId) && (op.id ? identities.has(op.id) : true)
      : identities.has(op.id);
  const completeChangeIds = new Set();
  const changes = source('crm_changes').filter((row) => parse(row.data.operations).some(operationSelected)).map((row) => {
    const operations = parse(row.data.operations);
    const selected = operations.filter(operationSelected);
    const results = parse(row.data.result).filter((diff) => identities.has(diff.entityId));
    const complete = selected.length === operations.length;
    if (complete) completeChangeIds.add(row.id);
    return { ...row, data: { ...row.data, operations: JSON.stringify(selected), result: JSON.stringify(results),
      ...(complete ? {} : { title: 'Imported selected history', summary: '', fingerprint: fingerprint(selected) }) } };
  });
  const flows = source('crm_flows').filter((row) => {
    const ids = parse(row.data.data).changeIds;
    return ids.length > 0 && ids.every((id) => completeChangeIds.has(id));
  });
  const flowIds = new Set(flows.map((row) => row.id));
  const selected = sourceRows.filter((row) => {
    if (['crm_meta','crm_policy'].includes(row.table)) return true;
    if (row.table === 'crm_collections') return collections.has(row.id);
    if (row.table === 'crm_records') return records.has(row.id);
    if (row.table === 'crm_views') return views.has(row.id);
    if (row.table === 'crm_note_library') return notes.size > 0;
    if (['crm_note_documents','crm_note_sync'].includes(row.table)) return notes.has(row.id);
    return false;
  });
  selected.push(...events,...changes,...flows,...source('crm_flow_updates').filter((row) => flowIds.has(row.data.flow_id)));
  for (const row of selected) {
    if (row.table === 'crm_note_documents' && parse(row.data.links).some((id) => !records.has(id))) throw new AppError('A selected note links to an excluded record. Review the selection.');
    if (row.table === 'crm_records') {
      const collection = source('crm_collections').find((candidate) => candidate.id === row.data.collection_id);
      const fields = parse(collection.data.data).fields;
      const values = parse(row.data.data);
      for (const field of fields.filter((field) => field.type === 'relation')) {
        if (!collections.has(field.collection) || values[field.key]?.some((id) => !records.has(id))) throw new AppError('A selected relationship targets excluded data. Review the selection.');
      }
    }
  }
  const engine = openWorkspaceEngine(selected);
  try { engine.crm.context(); engine.crm.export(); }
  finally { engine.close(); }
  return selected;
}

export function exportSelectedWorkspace(filename, selection) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    const sourceRows = Object.entries(workspaceTables).flatMap(([table, key]) => {
      if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table)) return [];
      return db.prepare(`SELECT * FROM ${table} ORDER BY ${key}`).all().map((data) => ({ table, id: String(data[key]), data: { ...data } }));
    });
    const rows = selectWorkspaceRows(sourceRows, selection);
    const counts = Object.fromEntries(Object.keys(workspaceTables).map((table) => [table, rows.filter((row) => row.table === table).length]));
    db.exec('COMMIT');
    return { format: 'nextstep-hosted-transfer', version: 1, exportedAt: new Date().toISOString(), selection, fingerprint: fingerprint(rows), counts, rows };
  } finally { db.close(); }
}

export function validateTransfer(value) {
  if (value?.format !== 'nextstep-hosted-transfer' || value.version !== 1 || fingerprint(value.rows) !== value.fingerprint)
    throw new AppError('Invalid transfer file or checksum.');
  const engine = openWorkspaceEngine(value.rows);
  try { engine.crm.export(); }
  finally { engine.close(); }
  return value;
}

export async function importTransfer(client, workspaceId, transfer, { apply = false } = {}) {
  validateTransfer(transfer);
  await client.query('BEGIN');
  try {
    const workspace = (await client.query('SELECT id,import_fingerprint FROM nextstep.workspaces WHERE id=$1 FOR UPDATE',[workspaceId])).rows[0];
    if (!workspace) throw new AppError('Create the destination workspace first.');
    if (workspace.import_fingerprint === transfer.fingerprint) { await client.query('ROLLBACK'); return { status: 'already_imported', fingerprint: transfer.fingerprint, counts: transfer.counts }; }
    const existing = (await client.query('SELECT count(*)::int AS count FROM nextstep.entities WHERE workspace_id=$1',[workspaceId])).rows[0].count;
    if (existing || workspace.import_fingerprint) throw new AppError('The destination is not empty. Import cannot replace an existing workspace.',409);
    if (!apply) { await client.query('ROLLBACK'); return { status: 'preview', fingerprint: transfer.fingerprint, counts: transfer.counts }; }
    await client.query(`INSERT INTO nextstep.entities(workspace_id,table_name,row_id,data)
      SELECT $1,x.table,x.id,x.data FROM jsonb_to_recordset($2::jsonb) AS x("table" text,id text,data jsonb)`,[workspaceId,JSON.stringify(transfer.rows)]);
    await client.query('UPDATE nextstep.workspaces SET import_fingerprint=$2,ready=true,revision=revision+1 WHERE id=$1',[workspaceId,transfer.fingerprint]);
    const actual = (await client.query('SELECT table_name AS table,row_id AS id,data FROM nextstep.entities WHERE workspace_id=$1 ORDER BY table_name,row_id',[workspaceId])).rows;
    const sort = (rows) => [...rows].sort((a,b) => `${a.table}:${a.id}`.localeCompare(`${b.table}:${b.id}`));
    if (fingerprint(sort(actual)) !== fingerprint(sort(transfer.rows))) throw new AppError('The imported content did not match the export.');
    await client.query('COMMIT');
    return { status: 'imported', fingerprint: transfer.fingerprint, counts: transfer.counts };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
