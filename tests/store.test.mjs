import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

function database(t) { const directory = mkdtempSync(join(tmpdir(),'nextstep-test-')); const file = join(directory,'test.sqlite'); const store = openStore(file); t.after(() => { store.close(); rmSync(directory,{recursive:true,force:true}); }); return {store,file}; }
test('search preferences start blank, persist across connections, and preserve jobs and history', t => {
  const {store,file} = database(t);
  const blank = store.getProfile();
  assert.ok(Object.entries(blank).filter(([key]) => !['version','updatedAt'].includes(key)).every(([,value]) => value === ''));
  const job = store.create({company:'Existing choice',stage:'interested'});
  const before = store.list(); const history = store.activity(job.id);
  const saved = store.updateProfile({version:0,roles:'  Community outreach  ',locations:'A region chosen by the user',preferences:'Nonprofits'});
  assert.equal(saved.roles,'Community outreach'); assert.equal(saved.version,1);
  const other = openStore(file);
  try {
    assert.deepEqual(other.getProfile(), saved);
    const updated = other.updateProfile({version:1,workStyle:'On site'});
    assert.equal(updated.roles,saved.roles);
    assert.throws(() => store.updateProfile({version:1,roles:'Stale answer'}),error => error.status === 409);
    assert.deepEqual(store.getProfile(),updated);
  } finally { other.close(); }
  assert.deepEqual(store.list(),before); assert.deepEqual(store.activity(job.id),history);
});
test('invalid profile writes leave preferences intact, and explicitly cleared fields stay blank', t => {
  const {store} = database(t);
  for (const input of [null,[],{}, {version:0,roles:7}, {version:0,roles:'x'.repeat(2001)}, {version:0,occupation:'Unknown field'}]) assert.throws(() => store.updateProfile(input));
  assert.equal(store.getProfile().version,0);
  const saved = store.updateProfile({version:0,roles:'A chosen role',exclusions:'An exclusion'});
  const cleared = store.updateProfile({version:saved.version,roles:''});
  assert.equal(cleared.roles,''); assert.equal(cleared.exclusions,saved.exclusions);
});
test('company-only prospects, optional fields, and edits survive reopening the database', t => {
  const {store,file} = database(t);
  const job = store.create({company:'  Test company  '});
  assert.equal(job.company,'Test company'); assert.equal(job.stage,'prospect'); assert.equal(job.role,'');
  const edited = store.update(job.id,{version:job.version,role:'Example Role',notes:'First call\nAsk about the team',followUp:'2026-10-02',stage:'screening',url:'https://example.com/jobs'});
  const second = openStore(file);
  assert.deepEqual(second.get(job.id),edited); second.close();
  assert.deepEqual(store.activity(job.id).map(event => event.action),['moved','created']);
});
test('dragging reorders within a stage and into an empty stage without losing other cards', t => {
  const {store} = database(t); const a = store.create({company:'A'}); const b = store.create({company:'B'}); const c = store.create({company:'C'});
  const moved = store.move(c.id,{stage:'prospect',beforeId:a.id,version:c.version});
  assert.deepEqual(store.list().map(job => job.company),['C','A','B']);
  store.move(moved.id,{stage:'interview',beforeId:null,version:moved.version});
  assert.deepEqual(store.list().filter(job => job.stage==='prospect').map(job => job.company),['A','B']);
  assert.equal(store.get(c.id).stage,'interview'); assert.equal(store.list().length,3);
  const bNow = store.get(b.id); store.move(b.id,{stage:'interview',beforeId:c.id,version:bNow.version});
  assert.deepEqual(store.list().filter(job => job.stage==='interview').map(job => job.company),['B','C']);
});
test('stale edits and invalid moves roll back atomically', t => {
  const {store} = database(t); const job = store.create({company:'A'}); const updated = store.update(job.id,{version:job.version,notes:'New note'});
  assert.throws(() => store.update(job.id,{version:job.version,notes:'Overwrite'}),error => error.status===409);
  assert.throws(() => store.move(job.id,{version:updated.version,stage:'offer',beforeId:'missing'}),error => error.status===409);
  assert.equal(store.get(job.id).notes,'New note'); assert.equal(store.get(job.id).stage,'prospect'); assert.equal(store.get(job.id).version,updated.version);
});
test('validation rejects unsafe links, invalid dates, and malformed fields', t => {
  const {store} = database(t);
  for (const value of [{company:''},{company:'A',url:'javascript:alert(1)'},{company:'A',url:'https://user:pass@example.com'},{company:'A',followUp:'2026-02-30'},{company:'A',followUp:'tomorrow'},{company:'A',stage:'made-up'},{company:'A',notes:123},{company:'A',priority:'urgent'},{company:'A',contactEmail:'not-email'}]) assert.throws(() => store.create(value));
  assert.equal(store.list().length,0);
});
test('closed opportunities remain editable and deletion can be undone', t => {
  const {store} = database(t); const job = store.create({company:'A',stage:'accepted'});
  store.remove(job.id,{version:job.version}); assert.equal(store.list().length,0); assert.throws(() => store.get(job.id));
  const restored = store.restore(job.id); assert.equal(restored.stage,'accepted'); assert.equal(store.list().length,1);
  assert.equal(store.update(job.id,{stage:'prospect',version:restored.version}).stage,'prospect');
});
for (const schemaVersion of [1,2,3]) test(`upgrading schema ${schemaVersion} preserves jobs and history and supports Uninterested`, t => {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-migration-'));
  const file = join(directory,'legacy.sqlite');
  t.after(() => rmSync(directory,{recursive:true,force:true}));
  const legacy = new DatabaseSync(file);
  legacy.exec(`PRAGMA foreign_keys = ON;
    CREATE TABLE opportunities (
      id TEXT PRIMARY KEY, data TEXT NOT NULL,
      stage TEXT NOT NULL CHECK(stage IN (${schemaVersion >= 3 ? "'uninterested'," : ''}'prospect',${schemaVersion >= 2 ? "'interested'," : ''}'applied','screening','interview','final','offer','accepted','rejected','withdrawn')),
      position INTEGER NOT NULL, version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
    );
    CREATE TABLE activity (
      id INTEGER PRIMARY KEY, opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
      action TEXT NOT NULL, from_stage TEXT, to_stage TEXT, created_at TEXT NOT NULL
    );
    PRAGMA user_version = ${schemaVersion};`);
  const timestamp = '2026-09-18T12:00:00.000Z';
  const notes = 'Saved application notes';
  const oldStage = schemaVersion >= 2 ? 'interested' : 'prospect';
  legacy.prepare('INSERT INTO opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('saved',JSON.stringify({company:'Saved company',notes}),oldStage,3,7,timestamp,timestamp,null);
  legacy.prepare('INSERT INTO opportunities VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run('deleted',JSON.stringify({company:'Removed company'}),'rejected',1,2,timestamp,timestamp,timestamp);
  legacy.prepare('INSERT INTO activity(opportunity_id,action,from_stage,to_stage,created_at) VALUES (?,?,?,?,?)').run('saved','created',null,oldStage,timestamp);
  const before = legacy.prepare('SELECT * FROM opportunities ORDER BY id').all();
  const history = legacy.prepare('SELECT * FROM activity').all();
  legacy.close();
  const store = openStore(file);
  try {
    const check = new DatabaseSync(file);
    try {
      assert.deepEqual(check.prepare('SELECT * FROM opportunities ORDER BY id').all(),before);
      assert.deepEqual(check.prepare('SELECT * FROM activity').all(),history);
      assert.deepEqual(check.prepare('PRAGMA foreign_key_check').all(),[]);
      assert.equal(check.prepare('PRAGMA user_version').get().user_version,6);
    } finally { check.close(); }
    const moved = store.move('saved',{stage:'uninterested',beforeId:null,version:7});
    assert.equal(moved.stage,'uninterested'); assert.equal(moved.notes,notes);
    assert.equal(store.activity('saved')[0].toStage,'uninterested');
    const created = store.create({company:'Not a fit',stage:'uninterested'});
    assert.equal(created.stage,'uninterested');
    assert.equal(store.update(created.id,{stage:'interested',version:created.version}).stage,'interested');
    assert.equal(store.restore('deleted').company,'Removed company');
    const reopened = openStore(file);
    try { assert.deepEqual(reopened.get('saved'),moved); } finally { reopened.close(); }
  } finally { store.close(); }
});
test('finder skips known and removed jobs, preserves user choices, and prepends ranked new prospects', t => {
  const {store} = database(t);
  const oldA = store.create({company:'Existing A',role:'Example Role'});
  const oldB = store.create({company:'Existing B',role:'Second Example Role'});
  const declined = store.create({company:'Declined',role:'Third Example Role',stage:'uninterested',notes:'Outside preferred responsibilities',url:'https://jobs.ashbyhq.com/declined/10000000-0000-0000-0000-000000000001'});
  const interested = store.create({company:'Selected',role:'Senior Example Role',stage:'interested',priority:'high',notes:'My notes',url:'https://jobs.ashbyhq.com/selected/10000000-0000-0000-0000-000000000002'});
  const applied = store.create({company:'Applied',role:'Second Example Role',stage:'applied',url:'https://jobs.lever.co/applied/10000000-0000-0000-0000-000000000003'});
  const removed = store.create({company:'Removed',role:'Sample Role',url:'https://example.com/jobs/removed'});
  store.remove(removed.id,{version:removed.version});
  const before = store.list(); const removedBefore = store.get(removed.id,true);
  const candidates = [
    {company:'New A',role:'Example Role',url:'https://example.com/jobs/new-a',stage:'interested',priority:'high'},
    {company:'Declined',role:'Renamed declined role',url:'https://declined.example/careers?ashby_jid=10000000-0000-0000-0000-000000000001&utm_source=test'},
    {company:'Selected',role:'Senior - Example Role',url:'https://example.com/alternate'},
    {company:'Applied',role:'Renamed role',url:'https://jobs.lever.co/applied/10000000-0000-0000-0000-000000000003/apply?utm_source=test'},
    {company:'Removed',role:'Sample Role',url:'https://example.com/jobs/removed?utm_source=test'},
    {company:'New B',role:'Second Example Role',url:'https://example.com/jobs/new-b'},
    {company:'New A',role:'Example Role',url:'https://example.com/jobs/new-a?utm_source=duplicate'},
  ];
  const preview = store.importProspects(candidates,{dryRun:true});
  assert.equal(preview.planned.length,2); assert.equal(preview.created.length,0);
  assert.deepEqual(store.list(),before);
  const result = store.importProspects(candidates);
  assert.deepEqual(result.created.map(job => job.company),['New A','New B']);
  assert.equal(result.skipped.length,5);
  assert.ok(result.created.every(job => job.stage === 'prospect' && job.priority === 'normal'));
  assert.deepEqual(store.list().filter(job => job.stage === 'prospect').map(job => job.company),['New A','New B','Existing A','Existing B']);
  for (const job of before) assert.deepEqual(store.get(job.id),job);
  assert.deepEqual(store.get(removed.id,true),removedBefore);
  for (const job of [oldA,oldB,declined,interested,applied]) assert.equal(store.activity(job.id).length,1);
  const after = store.list();
  const repeated = store.importProspects(candidates);
  assert.equal(repeated.created.length,0); assert.equal(repeated.skipped.length,candidates.length);
  assert.deepEqual(store.list(),after);
  const newest = store.importProspects([{company:'Next run',role:'Sample Role',url:'https://example.com/jobs/next-run'}]);
  assert.equal(store.list().filter(job => job.stage === 'prospect')[0].id,newest.created[0].id);
});
test('finder respects company exclusions while allowing different roles and rejects invalid batches atomically', t => {
  const {store} = database(t);
  store.create({company:'Excluded company',stage:'uninterested'});
  store.create({company:'Mixed company',role:'Third Example Role',stage:'uninterested'});
  const result = store.importProspects([
    {company:'Excluded company',role:'Second Example Role',url:'https://example.com/excluded'},
    {company:'Mixed company',role:'Second Example Role',url:'https://example.com/mixed'},
  ]);
  assert.equal(result.skipped[0].reason,'company marked uninterested');
  assert.equal(result.created[0].company,'Mixed company');
  const before = store.list();
  assert.throws(() => store.importProspects([
    {company:'Valid',role:'Sample Role',url:'https://example.com/valid'},
    {company:'Invalid',role:'Sample Role',url:'javascript:alert(1)'},
  ]));
  assert.throws(() => store.importProspects([{company:'Incomplete',url:'https://example.com/incomplete'}]));
  assert.deepEqual(store.list(),before);
});
test('finder CLI reads the same database and imports safely alongside an open app connection', t => {
  const {store,file} = database(t);
  const existing = store.create({company:'Already applied',role:'Sample Role',stage:'applied'});
  const script = fileURLToPath(new URL('../scripts/job-finder.sh',import.meta.url));
  const run = (...args) => {
    const result = spawnSync('/bin/sh',[script,...args],{encoding:'utf8',env:{...process.env,NEXTSTEP_DB_PATH:file}});
    assert.equal(result.status,0,result.stderr); return JSON.parse(result.stdout);
  };
  const context = run('context');
  assert.equal(context.database,file); assert.equal(context.byStage.applied[0].id,existing.id);
  const input = file + '.json';
  writeFileSync(input,JSON.stringify([{company:'CLI prospect',role:'Sample Role',url:'https://example.com/cli'}]));
  const preview = run('import',input,'--dry-run');
  assert.equal(preview.planned.length,1); assert.equal(store.list().length,1);
  const imported = run('import',input);
  assert.equal(imported.created.length,1);
  assert.equal(store.list().length,2);
  assert.equal(run('context').byStage.prospect[0].id,imported.created[0].id);
  assert.equal(run('import',input).created.length,0);
  assert.deepEqual(store.get(existing.id),existing);
});
