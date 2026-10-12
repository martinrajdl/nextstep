import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { backendOrigin, checkBackend } from '../server/backend.mjs';
import { startServer } from '../server/http.mjs';
import {
  readPreferences,
  writePreferences,
  accentColor,
} from '../desktop/preferences.mjs';

test('desktop backend selection allows only an explicit loopback tunnel origin', () => {
  assert.equal(
    backendOrigin('http://127.0.0.1:4319/'),
    'http://127.0.0.1:4319',
  );
  assert.equal(backendOrigin('http://localhost:4319'), 'http://localhost:4319');
  for (const url of [
    'https://example.com',
    'http://10.0.0.1:4319',
    'file:///tmp/app',
    'http://127.0.0.1',
    'http://user:password@localhost:4319',
    'http://localhost:4319/other',
    'http://localhost:4319/?host=example.com',
  ])
    assert.throws(() => backendOrigin(url));
});

test('bundled desktop interface proxies its backend, preserves host checks and never creates a shadow database', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-backend-'));
  const upstream = await startServer({
    port: 0,
    database: join(directory, 'server.sqlite'),
  });
  const shadow = join(directory, 'must-not-exist.sqlite');
  const desktop = await startServer({
    port: 0,
    backendUrl: upstream.url,
    database: shadow,
  });
  t.after(async () => {
    await desktop.close();
    await upstream.close();
    rmSync(directory, { recursive: true, force: true });
  });
  assert.equal(desktop.store, null);
  assert.equal(desktop.database, null);
  assert.equal(existsSync(shadow), false);
  const change = {
    id: randomUUID(),
    title: 'Create fictional collection',
    operations: [
      {
        type: 'create_collection',
        id: 'contacts',
        name: 'Example contacts',
        fields: [],
      },
    ],
  };
  const result = await fetch(desktop.url + '/api/crm/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: desktop.url },
    body: JSON.stringify(change),
  });
  assert.equal(result.status, 200);
  assert.equal(upstream.store.crm.collections()[0].id, 'contacts');
  const context = await (await fetch(desktop.url + '/api/crm/context')).json();
  assert.equal(context.collections[0].id, 'contacts');
  assert.equal(
    (
      await fetch(desktop.url + '/api/crm/context', {
        headers: { Origin: 'https://example.com' },
      })
    ).status,
    403,
  );
  const hostileHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      desktop.url + '/api/crm/context',
      { headers: { Host: 'example.com' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(hostileHost, 403);
  await upstream.close();
  const failed = await fetch(desktop.url + '/api/crm/context');
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /unavailable/);
  assert.equal(existsSync(shadow), false);
  await assert.rejects(checkBackend(upstream.url), /Could not reach/);
});

test('appearance changes preserve database and backend preferences across restarts', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-preferences-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writePreferences(directory, {
    database: join(directory, 'existing.sqlite'),
    backendUrl: 'http://127.0.0.1:4319',
  });
  writePreferences(directory, { accent: accentColor('#4473CF') });
  assert.deepEqual(readPreferences(directory), {
    database: join(directory, 'existing.sqlite'),
    backendUrl: 'http://127.0.0.1:4319',
    accent: '#4473cf',
  });
  assert.throws(() => accentColor('url(https://example.com)'));
});
