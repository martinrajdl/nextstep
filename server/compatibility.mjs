import { randomUUID } from 'node:crypto';
import { AppError } from './errors.mjs';

// The original connector keeps its SQL contract, but records live only in crm_records.
// These names describe existing data; fresh installations do not get this collection.
const stages = [
  'uninterested',
  'prospect',
  'interested',
  'applied',
  'screening',
  'interview',
  'final',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
];
const names = [
  'Uninterested',
  'Prospects',
  'Interested',
  'Applied',
  'Screening',
  'Interview',
  'Final round',
  'Offer',
  'Accepted',
  'Rejected',
  'Withdrawn',
];
const fields = [
  ['role', 'Role', 'text'],
  ['location', 'Location', 'text'],
  ['salary', 'Compensation', 'text'],
  ['url', 'Source', 'url'],
  ['contact', 'Contact', 'text'],
  ['contactEmail', 'Email', 'email', 'contact_email'],
  ['nextStep', 'Next step', 'longtext', 'next_step'],
  ['followUp', 'Follow-up', 'date', 'follow_up'],
  ['notes', 'Notes', 'longtext'],
];
const fieldDefinitions = [
  ...fields.map(([old, name, type, key = old]) => ({ key, name, type })),
  {
    key: 'priority',
    name: 'Priority',
    type: 'select',
    options: ['normal', 'high', 'low'],
  },
  {
    key: 'stage',
    name: 'Stage',
    type: 'select',
    required: true,
    options: stages,
  },
];
export const compatibilityCollection = (db) =>
  db
    .prepare("SELECT collection_id FROM crm_compatibility WHERE id='pipeline'")
    .get()?.collection_id || null;

export function ensureCompatibilityCollection(db) {
  const existing = compatibilityCollection(db);
  if (existing) return existing;
  let id = 'existing_workspace',
    suffix = 1;
  while (db.prepare('SELECT 1 FROM crm_collections WHERE id=?').get(id))
    id = `existing_workspace_${++suffix}`;
  const now = new Date().toISOString();
  db.prepare('INSERT INTO crm_collections VALUES (?,?,1,?,?)').run(
    id,
    JSON.stringify({
      name: 'Job search',
      description: '',
      color: '#77828e',
      fields: fieldDefinitions,
    }),
    now,
    now,
  );
  db.prepare(
    "INSERT INTO crm_compatibility(id,collection_id,revision) VALUES ('pipeline',?,1)",
  ).run(id);
  db.prepare('INSERT INTO crm_views VALUES (?,?,?,1,?,?)').run(
    randomUUID(),
    id,
    JSON.stringify({
      name: 'Pipeline',
      layout: 'board',
      groupBy: 'stage',
      hiddenGroups: [],
      quickActions: ['rejected', 'uninterested'],
      stageOrder: stages,
      stageNames: Object.fromEntries(
        stages.map((stage, i) => [stage, names[i]]),
      ),
      columns: ['role', 'location', 'next_step', 'salary'],
      filters: [],
      sort: { field: 'position', direction: 'asc' },
    }),
    now,
    now,
  );
  return id;
}

export function validateCompatibilitySchema(db, id, data) {
  if (compatibilityCollection(db) !== id) return;
  // Keep the saved connector's field mapping valid. Additional optional fields and stages are composable.
  for (const original of fieldDefinitions) {
    const field = data.fields.find((f) => f.key === original.key);
    if (
      !field ||
      field.type !== original.type ||
      (original.options &&
        original.options.some((option) => !field.options?.includes(option)))
    )
      throw new AppError(
        `The connected importer still uses ${original.name}. Keep its field type and original options; you can rename its label or add fields and stages.`,
      );
  }
  if (data.fields.some((f) => (f.required && f.key !== 'stage') || f.unique))
    throw new AppError(
      'Keep additional fields optional while the existing importer is connected.',
    );
}

export function logCompatibilityActivity(db, before, after) {
  const record = after || before;
  if (!record || record.collectionId !== compatibilityCollection(db)) return;
  const action = !before
    ? 'created'
    : !before.archivedAt && after.archivedAt
      ? 'deleted'
      : before.archivedAt && !after.archivedAt
        ? 'restored'
        : before.values.stage !== after.values.stage
          ? 'moved'
          : 'updated';
  db.prepare(
    'INSERT INTO activity(opportunity_id,action,from_stage,to_stage,created_at) VALUES (?,?,?,?,?)',
  ).run(
    record.id,
    action,
    before?.values.stage || null,
    after?.values.stage || null,
    after?.updatedAt || new Date().toISOString(),
  );
}

const snapshot = (row) =>
  `json_object('id',${row}.id,'collectionId',${row}.collection_id,'title',${row}.title,'values',json(${row}.data),'externalKey',${row}.external_key,'position',${row}.position,'version',${row}.version,'createdAt',${row}.created_at,'updatedAt',${row}.updated_at,'archivedAt',${row}.archived_at)`;
const legacyValues = (source) =>
  `json_object(${fields.map(([old, , , key = old]) => `'${key}',COALESCE(json_extract(${source}.data,'$.${old}'),'')`).join(',')},'priority',COALESCE(json_extract(${source}.data,'$.priority'),'normal'),'stage',${source}.stage)`;

export function migrateCompatibility(db) {
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec(
      'CREATE TABLE IF NOT EXISTS crm_compatibility (id TEXT PRIMARY KEY, collection_id TEXT NOT NULL UNIQUE REFERENCES crm_collections(id))',
    );
    if (
      !db
        .prepare('PRAGMA table_info(crm_compatibility)')
        .all()
        .some((column) => column.name === 'revision')
    )
      db.exec(
        'ALTER TABLE crm_compatibility ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
      );
    const alreadyUnified =
      db
        .prepare("SELECT type FROM sqlite_master WHERE name='opportunities'")
        .get()?.type === 'view';
    if (
      alreadyUnified &&
      db
        .prepare("SELECT revision FROM crm_compatibility WHERE id='pipeline'")
        .get()?.revision === 1
    ) {
      db.exec('COMMIT');
      return;
    }
    if (!alreadyUnified) {
      const rows = db
        .prepare('SELECT * FROM opportunities ORDER BY position,created_at,id')
        .all();
      const established =
        rows.length ||
        ['search_profile', 'agent_schedule', 'search_runs'].some((table) =>
          db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get(),
        );
      if (established) {
        const id = ensureCompatibilityCollection(db);
        const insert = db.prepare(
          'INSERT INTO crm_records(id,collection_id,title,data,external_key,version,created_at,updated_at,archived_at,position) VALUES (?,?,?,?,NULL,?,?,?,?,?)',
        );
        for (const row of rows) {
          const old = JSON.parse(row.data);
          const values = Object.fromEntries(
            fields.map(([key, , , next = key]) => [next, old[key] ?? '']),
          );
          values.priority = old.priority || 'normal';
          values.stage = row.stage;
          insert.run(
            row.id,
            id,
            old.company,
            JSON.stringify(values),
            row.version,
            row.created_at,
            row.updated_at,
            row.deleted_at,
            row.position,
          );
        }
        // Historical activity did not retain full snapshots. Preserve exactly what it recorded.
        db.prepare(`INSERT INTO crm_events(change_id,action,entity_type,entity_id,before_data,after_data,actor,created_at)
        SELECT 'existing-activity:'||a.id, a.action, 'record', a.opportunity_id,
          CASE WHEN a.from_stage IS NULL THEN NULL ELSE json_object('title',r.title,'stage',a.from_stage) END,
          json_object('title',r.title,'stage',a.to_stage), 'Existing history', a.created_at
        FROM activity a JOIN crm_records r ON r.id=a.opportunity_id ORDER BY a.id`).run();
      }
      // Repoint history foreign keys before removing the old storage table.
      db.exec(`CREATE TABLE activity_unified (
      id INTEGER PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES crm_records(id),
      action TEXT NOT NULL, from_stage TEXT, to_stage TEXT, created_at TEXT NOT NULL);
      INSERT INTO activity_unified SELECT * FROM activity;
      DROP TABLE activity;
      ALTER TABLE activity_unified RENAME TO activity;
      CREATE INDEX idx_activity_opportunity ON activity(opportunity_id,id);
      DROP TABLE opportunities;`);
    }
    const oldData = `json_object('company',title,${fields.map(([old, , , key = old]) => `'${old}',COALESCE(json_extract(data,'$.${key}'),'')`).join(',')},'priority',COALESCE(json_extract(data,'$.priority'),'normal'),'stage',json_extract(data,'$.stage'))`;
    db.exec(`CREATE VIEW IF NOT EXISTS opportunities AS SELECT id,${oldData} AS data,json_extract(data,'$.stage') AS stage,position,version,created_at,updated_at,archived_at AS deleted_at
      FROM crm_records WHERE collection_id=(SELECT collection_id FROM crm_compatibility WHERE id='pipeline');
      DROP TRIGGER IF EXISTS compatibility_insert;
      DROP TRIGGER IF EXISTS compatibility_update;
      CREATE TRIGGER compatibility_insert INSTEAD OF INSERT ON opportunities BEGIN
        SELECT CASE WHEN (SELECT review_required FROM crm_policy WHERE id=1)=1 THEN RAISE(ABORT,'Review is required. Reconnect the importer to submit a proposal.') END;
        INSERT INTO crm_records(id,collection_id,title,data,external_key,version,created_at,updated_at,archived_at,position)
        VALUES(NEW.id,(SELECT collection_id FROM crm_compatibility WHERE id='pipeline'),json_extract(NEW.data,'$.company'),${legacyValues('NEW')},NULL,COALESCE(NEW.version,1),NEW.created_at,NEW.updated_at,NEW.deleted_at,NEW.position);
        INSERT INTO crm_events(change_id,action,entity_type,entity_id,before_data,after_data,actor,created_at)
        SELECT 'connector:'||NEW.id||':'||version,'create_record','record',id,NULL,${snapshot('crm_records')},'Connected importer',updated_at FROM crm_records WHERE id=NEW.id;
      END;
      CREATE TRIGGER compatibility_update INSTEAD OF UPDATE ON opportunities BEGIN
        SELECT CASE WHEN (SELECT review_required FROM crm_policy WHERE id=1)=1 THEN RAISE(ABORT,'Review is required. Use the shared collection UI or submit a proposal.') END;
        INSERT INTO crm_events(change_id,action,entity_type,entity_id,before_data,after_data,actor,created_at)
        SELECT 'connector:'||NEW.id||':'||NEW.version,'update_record','record',id,${snapshot('crm_records')},NULL,'Connected importer',NEW.updated_at FROM crm_records WHERE id=OLD.id AND NEW.version<>OLD.version;
        UPDATE crm_records SET title=json_extract(NEW.data,'$.company'),data=json_patch(data,${legacyValues('NEW')}),position=NEW.position,version=NEW.version,created_at=NEW.created_at,updated_at=NEW.updated_at,archived_at=NEW.deleted_at WHERE id=OLD.id;
        UPDATE crm_events SET after_data=(SELECT ${snapshot('crm_records')} FROM crm_records WHERE id=NEW.id)
        WHERE id=last_insert_rowid() AND change_id='connector:'||NEW.id||':'||NEW.version AND NEW.version<>OLD.version;
      END;
      UPDATE crm_compatibility SET revision=1;
      PRAGMA user_version=7;`);
    if (db.prepare('PRAGMA foreign_key_check').all().length)
      throw new Error('Could not preserve workspace history during migration.');
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
