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
  const paths = { database: join(directory, 'data/jobs.sqlite'), profile: join(directory, 'data/profile.md') };
  const first = setupWorkspace(paths);
  assert.equal(first.existingDatabase, false);
  assert.equal(first.createdProfile, true);
  assert.match(readFileSync(paths.profile, 'utf8'), /Target roles/);
  const store = openStore(paths.database);
  try {
    assert.equal(store.list().length, 0);
    const job = store.create({ company: 'Example', stage: 'applied', notes: 'Keep my decision' });
    const history = store.activity(job.id);
    writeFileSync(paths.profile, 'My private search criteria');
    const second = setupWorkspace(paths);
    assert.equal(second.existingDatabase, true);
    assert.equal(second.createdProfile, false);
    assert.equal(readFileSync(paths.profile, 'utf8'), 'My private search criteria');
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
  setupWorkspace({ database, profile: join(directory, 'profile.md') });
  const initialized = spawnSync(process.execPath, args, options);
  assert.equal(initialized.status, 0, initialized.stderr);
  const context = JSON.parse(initialized.stdout);
  assert.equal(context.database, database);
  assert.equal(context.byStage.prospect.length, 0);
});
