import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { setupInstructions } from '../server/agent-instructions.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(),'nextstep-onboarding-'));
  const file = join(directory,'test.sqlite'); const store = openStore(file);
  t.after(() => { store.close(); rmSync(directory,{recursive:true,force:true}); });
  return {store,file};
}
test('fresh setup progress survives reopening and prevents stale or forged confirmation writes',t => {
  const {store,file} = fixture(t);
  const original = store.agentStatus().onboarding;
  assert.equal(original.status,'new');
  const saved = store.updateOnboarding({version:original.version,step:1,status:'started'});
  assert.throws(() => store.updateOnboarding({version:original.version,step:0,status:'new'}),error => error.status === 409);
  assert.throws(() => store.updateOnboarding({...saved,connectedAt:'fake'}));
  const reopened = openStore(file);
  try { assert.deepEqual(reopened.agentStatus().onboarding,saved); } finally { reopened.close(); }
  assert.equal(store.getProfile().roles,''); assert.equal(store.list().length,0);
});
test('schema 5 upgrade preserves decisions, removals, reports, schedule and preferences without forcing a wizard',t => {
  const {store,file} = fixture(t);
  const chosen = store.create({company:'Fictional Preferred',stage:'interested',notes:'The user chose this'});
  const removed = store.create({company:'Fictional Removed'}); store.remove(removed.id,{version:removed.version});
  store.updateProfile({version:0,roles:'Museum education'});
  const schedule = store.updateSchedule({version:0,provider:'codex',cadence:'Mondays at 10',timezone:'UTC'});
  store.updateSchedule({version:schedule.version,taskId:'existing-task'},{registration:true});
  store.recordSearchRun({id:'existing-report',summary:'Previous report',learning:'',evidenceIds:[],importedIds:[]});
  const before = {jobs:store.list(),history:store.activity(chosen.id),profile:store.getProfile(),agent:store.agentStatus()};
  const db = new DatabaseSync(file); db.exec('DROP TABLE onboarding; PRAGMA user_version=5;'); db.close();
  const upgraded = openStore(file);
  try {
    assert.deepEqual(upgraded.list(),before.jobs); assert.deepEqual(upgraded.activity(chosen.id),before.history);
    assert.deepEqual(upgraded.getProfile(),before.profile); assert.deepEqual(upgraded.agentStatus().schedule,before.agent.schedule);
    assert.deepEqual(upgraded.agentStatus().runs,before.agent.runs); assert.equal(upgraded.agentStatus().onboarding.status,'dismissed');
    assert.throws(() => upgraded.get(removed.id)); assert.equal(upgraded.get(removed.id,true).company,'Fictional Removed');
  } finally { upgraded.close(); }
});
test('on-demand setup is explicit and connection receipts are bound to the selected database and provider',t => {
  const {store,file} = fixture(t);
  const schedule = store.updateSchedule({version:0,provider:'codex',cadence:'',timezone:'UTC'});
  const waiting = store.agentStatus().onboarding;
  store.markAgentConfigured('codex'); assert.equal(store.agentStatus().onboarding.connectedAt,null);
  assert.throws(() => store.confirmConnection({token:'wrong-database'}));
  const confirmed = store.confirmConnection({token:waiting.connectionToken}); assert.ok(confirmed.connectedAt);
  const instructions = setupInstructions(schedule,confirmed,file);
  assert.match(instructions,/I selected on-demand searches/); assert.match(instructions,/Do not create a scheduled task/);
  assert.ok(instructions.includes(file)); assert.ok(instructions.includes(confirmed.connectionToken));
  assert.throws(() => store.updateSchedule({version:schedule.version,taskId:'not-allowed'},{registration:true}));
  store.updateSchedule({version:schedule.version,provider:'claude-code',cadence:'',timezone:'UTC'});
  assert.equal(store.agentStatus().onboarding.connectedAt,null); assert.equal(store.agentStatus().onboarding.configuredAt,null);
  assert.throws(() => store.confirmConnection({token:waiting.connectionToken}));
});
test('on-demand or provider changes cannot silently leave an existing scheduled task running',t => {
  const {store} = fixture(t);
  const saved = store.updateSchedule({version:0,provider:'codex',cadence:'Daily',timezone:'UTC'});
  const scheduled = store.updateSchedule({version:saved.version,taskId:'existing-task'},{registration:true});
  assert.throws(() => store.updateSchedule({version:scheduled.version,provider:'codex',cadence:'',timezone:'UTC'}),error => error.status === 409);
  assert.equal(store.agentStatus().schedule.taskId,'existing-task');
});
