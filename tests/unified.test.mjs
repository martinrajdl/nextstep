import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';
import { legacyFixture } from './legacy-fixture.mjs';
import { readContext } from '../server/context.mjs';
const change = (operations) => ({
  id: randomUUID(),
  title: 'Fictional change',
  operations,
});
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-unified-')),
    file = join(directory, 'example.sqlite');
  const store = openStore(file);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, file, directory };
}
test('existing SQL connections follow the migrated records in both directions without copies or lost metadata', (t) => {
  const { store, file, directory } = fixture(t);
  const original = store.create({
    company: 'Fictional Birch',
    role: 'Example role',
    notes: 'Exact notes\nSecond line',
    contactEmail: 'Case@Example.com',
    stage: 'interested',
    priority: 'high',
    followUp: '2026-11-01',
  });
  const removed = store.create({
    company: 'Fictional Archived',
    role: 'Example',
    url: 'https://example.com/archived',
  });
  store.remove(removed.id, { version: removed.version });
  const db = new DatabaseSync(file);
  legacyFixture(db);
  const oldReader = db.prepare('SELECT * FROM opportunities WHERE id=?');
  const oldWriter = db.prepare(
    'UPDATE opportunities SET data=?,version=version+1 WHERE id=?',
  );
  const oldRow = oldReader.get(original.id);
  const next = openStore(file);
  try {
    const id = next.compatibilityCollection(),
      crm = next.crm,
      collection = crm.getCollection(id);
    assert.equal(
      db
        .prepare("SELECT type FROM sqlite_master WHERE name='opportunities'")
        .get().type,
      'view',
    );
    assert.equal(crm.collections().length, 1);
    assert.equal(crm.getRecord(original.id).values.notes, original.notes);
    assert.deepEqual(next.get(original.id), original);
    const oldData = {
      ...JSON.parse(oldRow.data),
      notes: 'Updated through the saved connector',
    };
    oldWriter.run(JSON.stringify(oldData), original.id);
    assert.equal(crm.getRecord(original.id).values.notes, oldData.notes);
    const record = crm.getRecord(original.id);
    crm.apply(
      change([
        {
          type: 'update_record',
          id: record.id,
          version: record.version,
          collectionVersion: collection.version,
          values: { stage: 'rejected', next_step: 'Keep this decision' },
        },
      ]),
    );
    assert.equal(
      JSON.parse(oldReader.get(record.id).data).nextStep,
      'Keep this decision',
    );
    assert.equal(readContext(db, file).byStage.rejected[0].id, record.id);
    assert.throws(
      () =>
        next.update(record.id, { version: original.version, notes: 'Stale' }),
      { status: 409 },
    );
    const batch = [
      {
        company: 'Fictional Archived',
        role: 'Example',
        url: 'https://example.com/archived',
      },
      {
        company: 'Fictional New',
        role: 'Example',
        url: 'https://example.com/new',
      },
    ];
    const imported = next.importProspects(batch);
    assert.equal(imported.created.length, 1);
    assert.equal(imported.skipped.length, 1);
    assert.equal(next.importProspects(batch).created.length, 0);
    assert.equal(
      crm.query({
        collectionId: id,
        sort: { field: 'position', direction: 'asc' },
      }).records[0].id,
      imported.created[0].id,
    );
    const schemaChange = change([
      {
        type: 'update_collection',
        id,
        version: collection.version,
        fields: [
          ...collection.fields,
          { key: 'source_notes', name: 'Source notes', type: 'longtext' },
        ],
      },
    ]);
    crm.apply(schemaChange);
    const fresh = crm.getRecord(record.id);
    crm.apply(
      change([
        {
          type: 'update_record',
          id: record.id,
          version: fresh.version,
          collectionVersion: 2,
          values: { source_notes: 'Additional generic field' },
        },
      ]),
    );
    const compatible = next.get(record.id);
    next.update(record.id, {
      version: compatible.version,
      notes: 'Changed again',
    });
    assert.equal(
      crm.getRecord(record.id).values.source_notes,
      'Additional generic field',
    );
    assert.ok(
      crm
        .history({ entityId: record.id })
        .some(
          (event) =>
            event.actor === 'Connected importer' &&
            event.after?.values.notes === oldData.notes,
        ),
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    assert.ok(
      readdirSync(join(directory, 'backups')).some((name) =>
        name.startsWith('before-unified-'),
      ),
    );
  } finally {
    next.close();
    db.close();
  }
});

test('review is off by default, persists across connections, and never applies pending work when switched off', (t) => {
  const { store, file } = fixture(t),
    crm = store.crm;
  const other = openStore(file);
  try {
    assert.deepEqual(crm.policy(), { reviewRequired: false, version: 1 });
    assert.equal(
      other.crm.agentApply(
        change([
          {
            type: 'create_collection',
            id: 'research',
            name: 'Research',
            fields: [],
          },
        ]),
      ).status,
      'applied',
    );
    crm.setPolicy({ version: 1, reviewRequired: true });
    const input = change([
      {
        type: 'create_record',
        collectionId: 'research',
        collectionVersion: 1,
        title: 'Fictional note',
      },
    ]);
    const pending = other.crm.agentApply(input);
    assert.equal(pending.status, 'pending');
    assert.equal(crm.query({ collectionId: 'research' }).total, 0);
    crm.setPolicy({ version: 2, reviewRequired: false });
    assert.equal(other.crm.agentApply(input).status, 'pending');
    assert.equal(crm.query({ collectionId: 'research' }).total, 0);
    crm.review(pending.id, { version: 1, decision: 'approve' });
    assert.equal(crm.query({ collectionId: 'research' }).total, 1);
    assert.throws(
      () => other.crm.setPolicy({ version: 1, reviewRequired: true }),
      { status: 409 },
    );
  } finally {
    other.close();
  }
});

test('opt-in review also protects the bounded importer and old SQL writers', (t) => {
  const { store, file } = fixture(t),
    crm = store.crm;
  const kept = store.create({
    company: 'Fictional Keeper',
    stage: 'interested',
    notes: 'Keep',
  });
  crm.setPolicy({ version: 1, reviewRequired: true });
  const batch = [
    {
      company: 'Fictional Incoming',
      role: 'Example',
      url: 'https://example.com/incoming',
    },
  ];
  const result = store.importProspects(batch);
  assert.equal(result.status, 'pending');
  assert.equal(result.created.length, 0);
  assert.equal(store.list().length, 1);
  const old = new DatabaseSync(file);
  try {
    assert.throws(
      () =>
        old
          .prepare('UPDATE opportunities SET stage=? WHERE id=?')
          .run('rejected', kept.id),
      /Review is required/,
    );
  } finally {
    old.close();
  }
  crm.review(result.proposalId, { version: 1, decision: 'approve' });
  assert.equal(store.list()[0].company, 'Fictional Incoming');
  assert.deepEqual(store.get(kept.id), kept);
});

test('shared board movement preserves all fields and orders records within and across stages', (t) => {
  const { store } = fixture(t),
    crm = store.crm;
  const a = store.create({ company: 'Fictional A', notes: 'Keep A' }),
    b = store.create({ company: 'Fictional B', notes: 'Keep B' });
  const collectionId = store.compatibilityCollection();
  crm.apply(
    change([
      {
        type: 'move_record',
        id: b.id,
        version: b.version,
        collectionVersion: 1,
        field: 'stage',
        value: 'prospect',
        beforeId: a.id,
      },
    ]),
  );
  assert.deepEqual(
    crm
      .query({ collectionId, sort: { field: 'position', direction: 'asc' } })
      .records.map((r) => r.id),
    [b.id, a.id],
  );
  const moved = crm.getRecord(b.id);
  crm.apply(
    change([
      {
        type: 'move_record',
        id: b.id,
        version: moved.version,
        collectionVersion: 1,
        field: 'stage',
        value: 'rejected',
      },
    ]),
  );
  assert.equal(store.get(b.id).stage, 'rejected');
  assert.equal(store.get(b.id).notes, 'Keep B');
  assert.throws(
    () =>
      crm.apply(
        change([
          {
            type: 'move_record',
            id: a.id,
            version: a.version,
            collectionVersion: 1,
            field: 'stage',
            value: 'prospect',
            beforeId: b.id,
          },
        ]),
      ),
    { status: 409 },
  );
});
