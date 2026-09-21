import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { readContext } from '../server/context.mjs';
import { startServer } from '../server/http.mjs';
import { assertNextstepDatabase } from '../server/database-file.mjs';
import { setupInstructions } from '../server/agent-instructions.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-agent-'));
  const file = join(directory,'test.sqlite'); const store = openStore(file);
  t.after(() => { store.close(); rmSync(directory,{recursive:true,force:true}); });
  return {directory,file,store};
}
test('schema 4 upgrade retains preferences, jobs, removed records and history',t => {
  const {file,store} = fixture(t);
  const profile = store.updateProfile({version:0,roles:'The user\'s choice'});
  const job = store.create({company:'Original company',stage:'interested'});
  const before = store.list(); const activity = store.activity(job.id);
  const db = new DatabaseSync(file); db.exec('DROP TABLE agent_schedule; DROP TABLE search_runs; PRAGMA user_version=4;'); db.close();
  const upgraded = openStore(file);
  try { assert.deepEqual(upgraded.getProfile(),profile); assert.deepEqual(upgraded.list(),before); assert.deepEqual(upgraded.activity(job.id),activity); assert.deepEqual(upgraded.agentStatus().runs,[]); }
  finally { upgraded.close(); }
});
test('context always reflects current decisions and keeps tentative learning separate',t => {
  const {file,store} = fixture(t);
  const positive = store.create({company:'Positive example',role:'Chosen work',stage:'interested'});
  const negative = store.create({company:'Negative example',role:'Declined work',stage:'uninterested',notes:'Too much travel'});
  const profile = store.updateProfile({version:0,roles:'The user\'s choice'});
  store.recordSearchRun({id:'test-run-1',summary:'No new verified matches',learning:'Prefer less travel based on the declined role.',evidenceIds:[negative.id],importedIds:[]});
  const db = new DatabaseSync(file,{readOnly:true});
  try {
    const first = readContext(db,file);
    assert.equal(first.byStage.interested[0].id,positive.id); assert.equal(first.byStage.uninterested[0].id,negative.id);
    assert.equal(first.recentSearches[0].evidenceIds[0],negative.id); assert.deepEqual(first.profile,profile);
    store.move(positive.id,{stage:'uninterested',version:positive.version});
    const second = readContext(db,file,first.nextActivityCursor);
    assert.equal(second.byStage.interested.length,0); assert.equal(second.recentChanges.length,1); assert.equal(second.recentChanges[0].toStage,'uninterested');
    assert.equal(second.hasMoreChanges,false);
  } finally { db.close(); }
});
test('reports require real evidence and can be retried without duplicating or overwriting',t => {
  const {store} = fixture(t); const job = store.create({company:'Evidence',stage:'interested'});
  const input = {id:'stable-run-1',summary:'Search complete',learning:'Tentative adjustment',evidenceIds:[job.id],importedIds:[]};
  const before = store.list(); const history = store.activity(job.id);
  assert.throws(() => store.recordSearchRun({...input,evidenceIds:[]}));
  assert.throws(() => store.recordSearchRun({...input,evidenceIds:['missing']}));
  assert.equal(store.recordSearchRun(input).alreadyRecorded,false);
  assert.equal(store.recordSearchRun(input).alreadyRecorded,true);
  assert.throws(() => store.recordSearchRun({...input,summary:'Overwrite'}),error => error.status===409);
  assert.equal(store.agentStatus().runs.length,1); assert.deepEqual(store.list(),before); assert.deepEqual(store.activity(job.id),history);
});
test('schedule choices never activate a task and registration is versioned',t => {
  const {store} = fixture(t);
  const input = {version:0,provider:'codex',cadence:'Weekdays at 10',timezone:'Europe/Prague'};
  assert.throws(() => store.updateSchedule({...input,timezone:'Not/A_Timezone'}));
  const saved = store.updateSchedule(input);
  assert.equal(saved.taskId,''); assert.equal(saved.reportedAt,null);
  assert.match(setupInstructions(saved),/Weekdays at 10/);
  assert.throws(() => store.updateSchedule({version:0,taskId:'task-123'},{registration:true}));
  const registered = store.updateSchedule({version:saved.version,taskId:'task-123'},{registration:true});
  assert.ok(registered.reportedAt);
  const updated = store.updateSchedule({...input,version:registered.version,cadence:'Weekly on Friday'});
  assert.equal(updated.taskId,'task-123'); assert.equal(updated.reportedAt,null);
  assert.throws(() => store.updateSchedule({...input,version:updated.version,provider:'claude-code'}),error => error.status===409);
  const unlinked = store.forgetSchedule({version:updated.version}); assert.equal(unlinked.taskId,'');
});
test('an unrelated or missing SQLite file cannot silently become a Nextstep database',t => {
  const {directory,file} = fixture(t); assertNextstepDatabase(file);
  const missing = join(directory,'missing.sqlite'); assert.throws(() => assertNextstepDatabase(missing)); assert.equal(existsSync(missing),false);
  const other = join(directory,'other.sqlite'); const db = new DatabaseSync(other); db.exec('CREATE TABLE original (id INTEGER)'); db.close();
  assert.throws(() => assertNextstepDatabase(other));
  const check = new DatabaseSync(other); try { assert.deepEqual(check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name),['original']); } finally { check.close(); }
});
test('embedded HTTP API uses an ephemeral loopback port and rejects foreign origins',async t => {
  const {file} = fixture(t); const service = await startServer({port:0,database:file});
  try {
    assert.equal(service.server.address().address,'127.0.0.1');
    const state = await (await fetch(service.url+'/api/agent')).json();
    assert.equal(state.database,file); assert.deepEqual(state.connection.mcpServers.nextstep.args.slice(-2),['--database',file]);
    const denied = await fetch(service.url+'/api/agent/schedule',{method:'PATCH',headers:{Origin:'https://example.com','Content-Type':'application/json'},body:JSON.stringify({version:0,provider:'codex',cadence:'Daily',timezone:'UTC'})});
    assert.equal(denied.status,403);
    const allowed = await fetch(service.url+'/api/agent/schedule',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({version:0,provider:'codex',cadence:'Daily',timezone:'UTC'})});
    assert.equal(allowed.status,200); assert.equal((await allowed.json()).schedule.taskId,'');
  } finally { await service.close(); }
});
