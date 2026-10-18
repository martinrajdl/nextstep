import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { startServer } from '../server/http.mjs';
const change = (operations) => ({
  id: randomUUID(),
  title: 'Example change',
  actor: 'Example agent',
  operations,
});
const people = {
  type: 'create_collection',
  id: 'people',
  name: 'People',
  fields: [
    { key: 'email', name: 'Email', type: 'email', unique: true },
    {
      key: 'status',
      name: 'Status',
      type: 'select',
      options: ['New', 'Active'],
    },
    { key: 'score', name: 'Score', type: 'number' },
    { key: 'met', name: 'Met', type: 'date' },
    { key: 'verified', name: 'Verified', type: 'checkbox' },
  ],
};
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-composable-'));
  const file = join(directory, 'test.sqlite');
  const store = openStore(file);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, crm: store.crm, file };
}
function record(crm, input = {}) {
  const id = randomUUID();
  crm.apply(
    change([
      {
        type: 'create_record',
        id,
        collectionId: 'people',
        collectionVersion: crm.getCollection('people').version,
        title: 'Example Person',
        values: {},
        ...input,
      },
    ]),
  );
  return crm.getRecord(id);
}

test('additive migration and reopen preserve every legacy row, decision, profile, activity and schedule', (t) => {
  const { store, file } = fixture(t);
  for (const stage of ['interested', 'uninterested', 'applied', 'rejected'])
    store.create({
      company: `Fictional ${stage}`,
      stage,
      notes: 'Keep the exact user decision',
      priority: 'high',
    });
  const removed = store.create({ company: 'Fictional removed' });
  store.remove(removed.id, { version: removed.version });
  store.updateProfile({ version: 0, roles: 'Fictional chosen role' });
  store.updateSchedule({
    version: 0,
    provider: 'codex',
    cadence: 'Weekdays at 09:00',
    timezone: 'UTC',
  });
  const db = new DatabaseSync(file);
  const tables = [
    'opportunities',
    'activity',
    'search_profile',
    'agent_schedule',
    'search_runs',
    'onboarding',
  ];
  const snapshot = () =>
    Object.fromEntries(
      tables.map((name) => [
        name,
        db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all(),
      ]),
    );
  const before = snapshot();
  assert.equal(store.hasLegacyWorkspace(), true);
  db.exec(
    'DROP TABLE crm_events; DROP TABLE crm_changes; DROP TABLE crm_views; DROP TABLE crm_records; DROP TABLE crm_collections; DROP TABLE crm_meta',
  );
  for (let i = 0; i < 2; i++) {
    const reopened = openStore(file);
    assert.equal(reopened.crm.context().collections.length, 0);
    reopened.close();
  }
  assert.deepEqual(snapshot(), before);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
  db.close();
});
test('fresh and generic-only databases have no compatibility navigation, while existing private work remains reachable', async (t) => {
  const { store, crm } = fixture(t);
  assert.equal(store.hasLegacyWorkspace(), false);
  crm.apply(change([people]));
  record(crm);
  assert.equal(store.hasLegacyWorkspace(), false);
  const entry = store.create({company:'Fictional preserved record',stage:'interested',notes:'Keep my decision'});
  assert.equal(store.hasLegacyWorkspace(), true);
  store.remove(entry.id,{version:entry.version});
  assert.equal(store.hasLegacyWorkspace(), true);
  for (const [name, initialize] of [
    ['saved preferences', value => value.updateProfile({version:0,roles:'Fictional preference'})],
    ['started setup', value => value.updateOnboarding({version:0,status:'started',step:0})],
  ]) await t.test(name, child => {
    const {store: existing} = fixture(child);
    initialize(existing);
    assert.equal(existing.list().length,0);
    assert.equal(existing.hasLegacyWorkspace(),true);
  });
});
test('preview rolls back every operation; approved proposal persists atomically with stable IDs and provenance', (t) => {
  const { crm, file } = fixture(t);
  const input = change([
    people,
    {
      type: 'create_record',
      collectionId: 'people',
      collectionVersion: 1,
      title: 'Fictional Avery',
      values: { email: 'AVERY@example.com', score: 0, verified: false },
    },
  ]);
  const preview = crm.preview(input);
  assert.equal(preview.diffs.length, 2);
  assert.equal(crm.context().collections.length, 0);
  assert.equal(crm.history().length, 0);
  const proposal = crm.propose(input);
  assert.equal(proposal.status, 'pending');
  assert.equal(crm.context().collections.length, 0);
  const replay = crm.propose(input);
  assert.equal(replay.id, proposal.id);
  assert.equal(replay.replayed, true);
  assert.throws(() => crm.propose({ ...input, title: 'Different payload' }), {
    status: 409,
  });
  const approved = crm.review(proposal.id, { version: 1, decision: 'approve' });
  assert.equal(approved.status, 'approved');
  const saved = crm.query({ collectionId: 'people' }).records[0];
  assert.equal(saved.id, preview.diffs[1].entityId);
  assert.equal(saved.values.email, 'avery@example.com');
  assert.equal(saved.values.verified, false);
  assert.equal(saved.values.score, 0);
  assert.equal(crm.history().length, 2);
  assert.equal(crm.history()[0].actor, 'Example agent');
  assert.equal(crm.history()[0].after.id, saved.id);
  const reopened = openStore(file);
  assert.deepEqual(reopened.crm.getRecord(saved.id), saved);
  reopened.close();
  assert.throws(
    () => crm.review(proposal.id, { version: 1, decision: 'approve' }),
    { status: 409 },
  );
});
test('stale proposals fail in full and remain reviewable without partial inserts', (t) => {
  const { crm } = fixture(t);
  crm.apply(change([people]));
  const current = record(crm);
  const p = crm.propose(
    change([
      {
        type: 'create_record',
        collectionId: 'people',
        collectionVersion: 1,
        title: 'Must not be inserted',
      },
      {
        type: 'update_record',
        id: current.id,
        version: 1,
        collectionVersion: 1,
        values: { status: 'Active' },
      },
    ]),
  );
  crm.apply(
    change([
      {
        type: 'update_record',
        id: current.id,
        version: 1,
        collectionVersion: 1,
        title: 'Human edited',
      },
    ]),
  );
  const count = crm.history().length;
  assert.throws(() => crm.review(p.id, { version: 1, decision: 'approve' }), {
    status: 409,
  });
  assert.equal(crm.getChange(p.id).status, 'pending');
  assert.equal(crm.query({ collectionId: 'people' }).total, 1);
  assert.equal(crm.getRecord(current.id).title, 'Human edited');
  assert.equal(crm.history().length, count);
  crm.review(p.id, { version: 1, decision: 'reject' });
  assert.equal(crm.getChange(p.id).status, 'rejected');
});
test('invalid typed values, unknown keys, unsafe URLs, invalid dates and missing required values are rejected', (t) => {
  const { crm } = fixture(t);
  assert.throws(() => crm.apply(change([{...people,fields:[{key:'title',name:'Another title',type:'text'}]}])),/already has a title/);
  crm.apply(
    change([
      {
        ...people,
        fields: [
          ...people.fields,
          { key: 'website', name: 'Website', type: 'url' },
          { key: 'label', name: 'Label', type: 'text', required: true },
          {
            key: 'tags',
            name: 'Tags',
            type: 'multiselect',
            options: ['A', 'B'],
          },
        ],
      },
    ]),
  );
  const invalid = [
    { label: 'Valid', score: 'one' },
    { label: 'Valid', score: Infinity },
    { label: 'Valid', status: 'Unknown' },
    { label: 'Valid', email: 'bad' },
    { label: 'Valid', website: 'javascript:alert(1)' },
    { label: 'Valid', website: 'https://user:pass@example.com' },
    { label: 'Valid', met: '2026-02-31' },
    { label: 'Valid', verified: 'true' },
    { label: 'Valid', unknown: 'x' },
    { label: 'Valid', tags: ['C'] },
    {},
  ];
  for (const values of invalid) assert.throws(() => record(crm, { values }));
  assert.equal(crm.query({ collectionId: 'people' }).total, 0);
  const saved = record(crm, {
    values: {
      label: 'Valid',
      score: 42,
      verified: false,
      website: 'https://example.com',
      met: '2026-10-12',
      tags: ['A', 'B'],
    },
  });
  assert.equal(saved.values.website, 'https://example.com/');
});
test('archive retains identity, relations, history and restores with optimistic versions', (t) => {
  const { crm } = fixture(t);
  crm.apply(change([people]));
  const a = record(crm, {
    externalKey: 'source-1',
    values: { email: 'a@example.com' },
  });
  crm.apply(
    change([
      {
        type: 'create_collection',
        id: 'projects',
        name: 'Projects',
        fields: [
          {
            key: 'people',
            name: 'People',
            type: 'relation',
            collection: 'people',
          },
        ],
      },
    ]),
  );
  const project = randomUUID();
  crm.apply(
    change([
      {
        type: 'create_record',
        id: project,
        collectionId: 'projects',
        collectionVersion: 1,
        title: 'Fictional project',
        values: { people: [a.id] },
      },
    ]),
  );
  assert.throws(
    () =>
      crm.apply(
        change([
          {
            type: 'update_record',
            id: project,
            version: 1,
            collectionVersion: 1,
            values: { people: [project] },
          },
        ]),
      ),
    /wrong collection/,
  );
  crm.apply(change([{ type: 'archive_record', id: a.id, version: 1 }]));
  assert.equal(crm.query({ collectionId: 'people' }).total, 0);
  assert.equal(crm.query({ collectionId: 'people', archived: true }).total, 1);
  assert.deepEqual(crm.getRecord(project).values.people, [a.id]);
  assert.throws(() => record(crm, { externalKey: 'source-1' }), {
    status: 409,
  });
  assert.throws(() => record(crm, { values: { email: 'A@example.com' } }), {
    status: 409,
  });
  assert.throws(
    () => crm.apply(change([{ type: 'restore_record', id: a.id, version: 1 }])),
    { status: 409 },
  );
  crm.apply(change([{ type: 'restore_record', id: a.id, version: 2 }]));
  assert.equal(crm.getRecord(a.id).version, 3);
  assert.equal(crm.history({ entityId: a.id }).length, 3);
});
test('schema changes cannot drop existing values or break views; record proposals pin schema versions', (t) => {
  const { crm } = fixture(t);
  crm.apply(change([people]));
  record(crm, { values: { status: 'Active' } });
  const viewId = randomUUID();
  crm.apply(
    change([
      {
        type: 'create_view',
        id: viewId,
        collectionId: 'people',
        name: 'Status board',
        layout: 'board',
        groupBy: 'status',
      },
    ]),
  );
  assert.throws(
    () =>
      crm.apply(
        change([
          {
            type: 'update_collection',
            id: 'people',
            version: 1,
            fields: people.fields.filter((f) => f.key !== 'status'),
          },
        ]),
      ),
    /Unknown field/,
  );
  assert.throws(
    () =>
      crm.apply(
        change([
          {
            type: 'update_collection',
            id: 'people',
            version: 1,
            fields: people.fields.map((f) =>
              f.key === 'status' ? { ...f, options: ['New'] } : f,
            ),
          },
        ]),
      ),
    /allowed option/,
  );
  const proposal = crm.propose(
    change([
      {
        type: 'create_record',
        collectionId: 'people',
        collectionVersion: 1,
        title: 'Prepared earlier',
      },
    ]),
  );
  crm.apply(
    change([
      {
        type: 'update_collection',
        id: 'people',
        version: 1,
        fields: [
          ...people.fields,
          { key: 'notes', name: 'Notes', type: 'longtext' },
        ],
      },
    ]),
  );
  assert.throws(
    () => crm.review(proposal.id, { version: 1, decision: 'approve' }),
    { status: 409 },
  );
  assert.equal(crm.views('people')[0].id, viewId);
});
test('bounded query filters, sort, pagination and durable view definitions work without SQL input interpolation', (t) => {
  const { crm } = fixture(t);
  crm.apply(change([people]));
  for (let n = 0; n < 6; n++)
    record(crm, {
      title: `Fictional ${n}`,
      values: { score: n, status: n % 2 ? 'New' : 'Active' },
    });
  let result = crm.query({
    collectionId: 'people',
    filters: [{ field: 'score', op: 'gte', value: 2 }],
    sort: { field: 'score', direction: 'asc' },
    limit: 2,
  });
  assert.equal(result.total, 4);
  assert.equal(result.records[0].values.score, 2);
  assert.equal(result.nextOffset, 2);
  result = crm.query({ collectionId: 'people', search: 'Fictional 4' });
  assert.equal(result.total, 1);
  assert.equal(
    crm.query({
      collectionId: 'people',
      filters: [{ field: 'email', op: 'empty' }],
    }).total,
    6,
  );
  assert.throws(() =>
    crm.query({
      collectionId: 'people',
      sort: { field: 'title; DROP TABLE crm_records', direction: 'asc' },
    }),
  );
  assert.throws(() => crm.query({ collectionId: 'people', limit: 201 }));
  const v = crm.apply(
    change([
      {
        type: 'create_view',
        collectionId: 'people',
        name: 'Active people',
        layout: 'table',
        columns: ['score'],
        filters: [{ field: 'status', op: 'eq', value: 'Active' }],
        sort: { field: 'score', direction: 'desc' },
      },
    ]),
  ).result[0].after;
  assert.equal(crm.query({ collectionId: 'people', ...v }).total, 3);
  crm.apply(change([{ type: 'delete_view', id: v.id, version: 1 }]));
  assert.equal(crm.views('people').length, 0);
});
test('complete export contains archived records, schemas, proposal decisions and full provenance', (t) => {
  const { crm } = fixture(t);
  crm.apply(change([people]));
  const a = record(crm);
  crm.apply(change([{ type: 'archive_record', id: a.id, version: 1 }]));
  const p = crm.propose(
    change([
      {
        type: 'create_record',
        collectionId: 'people',
        collectionVersion: 1,
        title: 'Rejected example',
      },
    ]),
  );
  crm.review(p.id, { version: 1, decision: 'reject' });
  const data = crm.export();
  assert.equal(data.format, 'nextstep-workspace');
  assert.equal(data.records.length, 1);
  assert.ok(data.records[0].archivedAt);
  assert.equal(data.changes.length, 4);
  assert.equal(data.history.length, 3);
  assert.equal(data.changes.find((c) => c.id === p.id).status, 'rejected');
});
test('HTTP routes preserve loopback Host/Origin protections and expose review operations without trusting an actor on direct UI writes', async (t) => {
  const { file } = fixture(t);
  const service = await startServer({ port: 0, database: file });
  t.after(() => service.close());
  const call = (path, body, headers = {}) =>
    fetch(service.url + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const deniedHost = await new Promise((resolve, reject) => {
    const req = httpRequest(
      service.url + '/api/crm/context',
      { headers: { host: 'attacker.example' } },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      },
    );
    req.on('error', reject);
    req.end();
  });
  assert.equal(deniedHost, 403);
  assert.equal(
    (
      await call('/api/crm/apply', change([people]), {
        Origin: 'https://example.com',
      })
    ).status,
    403,
  );
  const res = await call('/api/crm/apply', {
    ...change([people]),
    actor: 'Pretending to be trusted',
  });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).actor, 'You');
  const proposed = await (
    await call(
      '/api/crm/proposals',
      change([
        {
          type: 'create_record',
          collectionId: 'people',
          collectionVersion: 1,
          title: 'Example API',
        },
      ]),
    )
  ).json();
  assert.equal(
    (await call('/api/crm/query', { collectionId: 'people' })).status,
    200,
  );
  const reviewed = await call(`/api/crm/changes/${proposed.id}/review`, {
    version: 1,
    decision: 'approve',
  });
  assert.equal(reviewed.status, 200);
  assert.equal(
    (await (await fetch(service.url + '/api/crm/export')).json()).records
      .length,
    1,
  );
});
