import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { setupWorkspace } from '../scripts/setup.mjs';
import { databasePath, root } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';

test('fresh setup is empty and repeat setup preserves jobs, history and the private profile', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const paths = { database: join(directory, 'data/jobs.sqlite') };
  const first = setupWorkspace(paths);
  assert.equal(first.existingDatabase, false);
  assert.equal(first.profile.roles, '');
  assert.equal(first.profile.version, 0);
  const store = openStore(paths.database);
  try {
    assert.equal(store.list().length, 0);
    const job = store.create({ company: 'Example', stage: 'applied', notes: 'Keep my decision' });
    const history = store.activity(job.id);
    const profile = store.updateProfile({version: 0, roles: 'Museum education', employmentType: 'Part time', exclusions: 'Sales roles'});
    const legacyProfile = join(directory, 'data/profile.md');
    writeFileSync(legacyProfile, 'An older private profile to keep');
    const second = setupWorkspace(paths);
    assert.equal(second.existingDatabase, true);
    assert.deepEqual(second.profile, profile);
    assert.equal(readFileSync(legacyProfile, 'utf8'), 'An older private profile to keep');
    assert.deepEqual(store.get(job.id), job);
    assert.deepEqual(store.activity(job.id), history);
  } finally { store.close(); }
});

test('all entry points share the explicit database setting, including the legacy alias', () => {
  assert.equal(databasePath({}), resolve(root, 'data/nextstep.sqlite'));
  assert.equal(databasePath({ DB_PATH: '/tmp/legacy.sqlite' }), '/tmp/legacy.sqlite');
  assert.equal(databasePath({ NEXTSTEP_DB_PATH: '/tmp/preferred.sqlite', DB_PATH: '/tmp/legacy.sqlite' }), '/tmp/preferred.sqlite');
});

test('CLI refuses missing databases and reads an initialized database from another working directory', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-cli-setup-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'jobs.sqlite');
  const args = [resolve(root, 'scripts/job-finder.mjs'), 'context'];
  const options = { cwd: directory, encoding: 'utf8', env: { ...process.env, NEXTSTEP_DB_PATH: database } };
  const missing = spawnSync(process.execPath, args, options);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Do not create a replacement database/);
  setupWorkspace({ database });
  const initialized = spawnSync(process.execPath, args, options);
  assert.equal(initialized.status, 0, initialized.stderr);
  const context = JSON.parse(initialized.stdout);
  assert.equal(context.database, database);
  assert.equal(context.byStage.prospect.length, 0);
  assert.equal(context.profile.roles, '');
});

test('setup agent saves preferences into the same app database and context returns them', t => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-profile-cli-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const database = join(directory, 'jobs.sqlite');
  setupWorkspace({ database });
  const script = resolve(root, 'scripts/job-finder.mjs');
  const options = { cwd: directory, encoding: 'utf8', env: { ...process.env, NEXTSTEP_DB_PATH: database } };
  const run = (...args) => spawnSync(process.execPath, [script, ...args], options);
  const initial = JSON.parse(run('profile', 'get').stdout).profile;
  const file = join(directory, 'answers.json');
  writeFileSync(file, JSON.stringify({ version: initial.version, roles: 'Library services', locations: 'User-defined region', workStyle: 'On site', experience: 'User-provided qualifications' }));
  const save = run('profile', 'set', file);
  assert.equal(save.status, 0, save.stderr);
  const saved = JSON.parse(save.stdout).profile;
  const context = JSON.parse(run('context').stdout);
  assert.deepEqual(context.profile, saved);
  const app = openStore(database);
  try { assert.deepEqual(app.getProfile(), saved); } finally { app.close(); }
  assert.equal(run('profile', 'set', file).status, 1, 'Stale setup answers must not overwrite an app edit');
  assert.deepEqual(JSON.parse(run('profile', 'get').stdout).profile, saved);
});
