import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { companyKey, opportunityKeys } from './job-identity.mjs';

export const STAGES = ['uninterested', 'prospect', 'interested', 'applied', 'screening', 'interview', 'final', 'offer', 'accepted', 'rejected', 'withdrawn'];
const opportunityColumns = `
  id TEXT PRIMARY KEY, data TEXT NOT NULL, stage TEXT NOT NULL CHECK(stage IN (${STAGES.map(stage => `'${stage}'`).join(',')})),
  position INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
`;
export class AppError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const profileLimits = { roles: 2000, locations: 2000, workStyle: 1000, employmentType: 1000, compensation: 1000, experience: 8000, preferences: 4000, exclusions: 4000 };
export function readSearchProfile(db) {
  const blank = { ...Object.fromEntries(Object.keys(profileLimits).map(key => [key, ''])), version: 0, updatedAt: null };
  // Context is read-only and must also work before an existing database is upgraded.
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search_profile'").get()) return blank;
  const row = db.prepare('SELECT * FROM search_profile WHERE id = 1').get();
  return row ? { ...blank, ...JSON.parse(row.data), version: row.version, updatedAt: row.updated_at } : blank;
}
const limits = { company: 160, role: 200, location: 200, salary: 160, url: 2000, contact: 200, contactEmail: 254, nextStep: 500, followUp: 10, notes: 20000 };
const defaults = Object.fromEntries(Object.keys(limits).map(key => [key, '']));
function validate(input, current = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('An opportunity must be an object.');
  const value = { ...defaults, priority: 'normal', stage: 'prospect', ...current };
  for (const [key, limit] of Object.entries(limits)) {
    if (input[key] === undefined) continue;
    if (typeof input[key] !== 'string' || input[key].length > limit) throw new AppError(`${key} must be text of at most ${limit} characters.`);
    value[key] = input[key].trim();
  }
  if (!value.company) throw new AppError('Add a company name.');
  if (input.stage !== undefined) value.stage = input.stage;
  if (!STAGES.includes(value.stage)) throw new AppError('Choose a valid interview stage.');
  if (input.priority !== undefined) value.priority = input.priority;
  if (!['normal', 'high', 'low'].includes(value.priority)) throw new AppError('Choose a valid priority.');
  if (value.url) {
    try {
      const url = new URL(value.url);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error();
      value.url = url.href;
    } catch { throw new AppError('Use a complete http:// or https:// job link.'); }
  }
  if (value.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contactEmail)) throw new AppError('Enter a valid email address.');
  if (value.followUp && (!/^\d{4}-\d{2}-\d{2}$/.test(value.followUp) || !Number.isFinite(Date.parse(value.followUp)) || new Date(value.followUp).toISOString().slice(0,10) !== value.followUp)) throw new AppError('Choose a valid follow-up date.');
  return Object.fromEntries([...Object.keys(limits), 'priority', 'stage'].map(key => [key, value[key]]));
}

export function openStore(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (schemaVersion > 4) { db.close(); throw new Error('This database requires a newer version of Nextstep.'); }
  db.exec(`CREATE TABLE IF NOT EXISTS opportunities (${opportunityColumns});
  CREATE INDEX IF NOT EXISTS idx_opportunities_stage_position ON opportunities(stage, position) WHERE deleted_at IS NULL;
  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
    action TEXT NOT NULL, from_stage TEXT, to_stage TEXT, created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_activity_opportunity ON activity(opportunity_id, id);`);
  if (schemaVersion < 3) {
    // Rebuild the constrained table while preserving records and activity references.
    db.exec('PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;');
    try {
      db.exec(`CREATE TABLE opportunities_v3 (${opportunityColumns});
        INSERT INTO opportunities_v3 SELECT * FROM opportunities;
        DROP TABLE opportunities;
        ALTER TABLE opportunities_v3 RENAME TO opportunities;
        CREATE INDEX idx_opportunities_stage_position ON opportunities(stage, position) WHERE deleted_at IS NULL;
        PRAGMA user_version = 3;`);
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Database migration could not preserve activity references.');
      db.exec('COMMIT;');
    } catch (error) {
      db.exec('ROLLBACK;');
      throw error;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
  if (schemaVersion < 4) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS search_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL,
        version INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 4;
      COMMIT;`);
  }
  const hydrate = row => row ? { ...JSON.parse(row.data), id: row.id, stage: row.stage, position: row.position, version: row.version, createdAt: row.created_at, updatedAt: row.updated_at } : null;
  const list = () => db.prepare('SELECT * FROM opportunities WHERE deleted_at IS NULL ORDER BY position, created_at, id').all().map(hydrate);
  const get = (id, includeDeleted = false) => {
    const row = db.prepare(`SELECT * FROM opportunities WHERE id = ? ${includeDeleted ? '' : 'AND deleted_at IS NULL'}`).get(id);
    if (!row) throw new AppError('This opportunity no longer exists.', 404);
    return hydrate(row);
  };
  const activity = id => { get(id); return db.prepare('SELECT action, from_stage AS fromStage, to_stage AS toStage, created_at AS createdAt FROM activity WHERE opportunity_id = ? ORDER BY id DESC LIMIT 50').all(id); };
  const log = (id, action, from = null, to = null) => db.prepare('INSERT INTO activity(opportunity_id,action,from_stage,to_stage,created_at) VALUES (?,?,?,?,?)').run(id, action, from, to, new Date().toISOString());
  const transaction = fn => { db.exec('BEGIN IMMEDIATE'); try { const result = fn(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } };
  const checkVersion = (input, job) => { if (!Number.isInteger(input.version)) throw new AppError('The current opportunity version is required.'); if (input.version !== job.version) throw new AppError('This opportunity changed in another window. Close and reopen it to use the latest version.', 409); };
  const nextPosition = stage => Number(db.prepare('SELECT COALESCE(MAX(position), -1) + 1 AS n FROM opportunities WHERE stage = ? AND deleted_at IS NULL').get(stage).n);
  const insert = (data, position, id = randomUUID()) => {
    const now = new Date().toISOString();
    db.prepare('INSERT INTO opportunities(id,data,stage,position,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,JSON.stringify(data),data.stage,position,now,now);
    log(id,'created',null,data.stage);
    return get(id);
  };
  return {
    list, get, activity,
    getProfile() { return readSearchProfile(db); },
    updateProfile(input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError('Search preferences must be an object.');
      if (Object.keys(input).some(key => key !== 'version' && !Object.hasOwn(profileLimits, key))) throw new AppError('Unknown search preference field.');
      return transaction(() => {
        const current = readSearchProfile(db);
        if (!Number.isInteger(input.version) || input.version < 0) throw new AppError('The current search preferences version is required.');
        if (input.version !== current.version) throw new AppError('Search preferences changed elsewhere. Close and reopen them before saving.', 409);
        const data = {};
        for (const [key, limit] of Object.entries(profileLimits)) {
          const value = input[key] === undefined ? current[key] : input[key];
          if (typeof value !== 'string' || value.length > limit) throw new AppError(`${key} must be text of at most ${limit} characters.`);
          data[key] = value.trim();
        }
        db.prepare(`INSERT INTO search_profile(id, data, version, updated_at) VALUES (1, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET data = excluded.data, version = excluded.version, updated_at = excluded.updated_at`)
          .run(JSON.stringify(data), current.version + 1, new Date().toISOString());
        return readSearchProfile(db);
      });
    },
    create(input) {
      const data = validate(input);
      return transaction(() => insert(data,nextPosition(data.stage)));
    },
    importProspects(input, {dryRun = false} = {}) {
      if (!Array.isArray(input) || input.length > 100) throw new AppError('Import an array of at most 100 verified jobs.');
      const candidates = input.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new AppError('Each imported job must be an object.');
        const data = validate({...item,stage:'prospect',priority:'normal'});
        if (!data.role || !data.url) throw new AppError('Imported jobs need a company, role and verified job URL.');
        return data;
      });
      return transaction(() => {
        const rows = db.prepare('SELECT * FROM opportunities ORDER BY deleted_at, position, created_at, id').all().map(row => ({...hydrate(row),removed:Boolean(row.deleted_at)}));
        const seen = new Map(); const excludedCompanies = new Map();
        for (const row of rows) {
          for (const key of opportunityKeys(row)) if (!seen.has(key)) seen.set(key,row);
          if (row.stage === 'uninterested' && !row.role) excludedCompanies.set(companyKey(row),row);
        }
        const pending = []; const skipped = [];
        for (const data of candidates) {
          const keys = opportunityKeys(data);
          const excluded = excludedCompanies.get(companyKey(data));
          const duplicate = keys.map(key => seen.get(key)).find(Boolean);
          const match = excluded || duplicate;
          if (match) {
            skipped.push({company:data.company,role:data.role,existingId:match.id,existingStage:match.stage,removed:Boolean(match.removed),reason:excluded ? 'company marked uninterested' : 'already known'});
            continue;
          }
          const entry = {data,id:randomUUID()}; pending.push(entry);
          for (const key of keys) seen.set(key,{...data,id:entry.id});
        }
        const first = Number(db.prepare("SELECT COALESCE(MIN(position), 0) AS n FROM opportunities WHERE stage = 'prospect' AND deleted_at IS NULL").get().n) - pending.length;
        const created = dryRun ? [] : pending.map((entry,index) => insert(entry.data,first+index,entry.id));
        return {dryRun,created,planned:dryRun ? pending.map(entry => entry.data) : [],skipped};
      });
    },
    update(id, input) {
      return transaction(() => {
        const current = get(id); checkVersion(input, current); const data = validate(input, current);
        db.prepare('UPDATE opportunities SET data = ?, stage = ?, position = ?, version = version + 1, updated_at = ? WHERE id = ?').run(JSON.stringify(data), data.stage, data.stage === current.stage ? current.position : nextPosition(data.stage), new Date().toISOString(), id);
        log(id, data.stage === current.stage ? 'updated' : 'moved', current.stage, data.stage); return get(id);
      });
    },
    move(id, input) {
      return transaction(() => {
        const current = get(id); checkVersion(input, current);
        if (!STAGES.includes(input.stage)) throw new AppError('Choose a valid interview stage.');
        const target = list().filter(job => job.stage === input.stage && job.id !== id);
        const at = input.beforeId == null ? target.length : target.findIndex(job => job.id === input.beforeId);
        if (at < 0) throw new AppError('The target card moved. Try moving the opportunity again.', 409);
        target.splice(at, 0, { ...current, stage: input.stage });
        const setPosition = db.prepare('UPDATE opportunities SET position = ? WHERE id = ?');
        target.forEach((job, index) => setPosition.run(index, job.id));
        db.prepare('UPDATE opportunities SET stage = ?, version = version + 1, updated_at = ? WHERE id = ?').run(input.stage, new Date().toISOString(), id);
        if (current.stage !== input.stage) log(id, 'moved', current.stage, input.stage);
        return get(id);
      });
    },
    remove(id, input) {
      return transaction(() => {
        checkVersion(input, get(id));
        db.prepare('UPDATE opportunities SET deleted_at = ?, version = version + 1 WHERE id = ?').run(new Date().toISOString(), id);
        log(id, 'deleted');
      });
    },
    restore(id) {
      return transaction(() => {
        const current = get(id, true);
        db.prepare('UPDATE opportunities SET deleted_at = NULL, position = ?, version = version + 1 WHERE id = ?').run(nextPosition(current.stage), id);
        log(id, 'restored'); return get(id);
      });
    },
    close() { db.close(); },
  };
}
