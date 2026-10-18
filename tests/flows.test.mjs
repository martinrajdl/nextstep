import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../server/store.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-flows-')),
    file = join(directory, 'test.sqlite');
  let store = openStore(file);
  t.after(() => {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return {
    get store() {
      return store;
    },
    file,
    reopen() {
      store.close();
      store = openStore(file);
      return store;
    },
  };
}
const change = (operations) => ({
  id: randomUUID(),
  title: 'Fictional agent work',
  actor: 'Example agent',
  operations,
});
test('agent flows report progress idempotently and derive applied work from real review outcomes', (t) => {
  const f = fixture(t),
    crm = f.store.crm;
  const initial = {
    id: 'example-flow',
    reportId: 'source-1',
    version: 0,
    goal: 'Find fictional design partners',
    actor: 'Example agent',
    stage: 'sourcing',
    message: 'Reading example sources',
    sources: [{ label: 'Fictional studio', url: 'https://example.com/studio' }],
  };
  let flow = crm.flows.report(initial);
  assert.equal(flow.version, 1);
  assert.equal(crm.flows.report(initial).replayed, true);
  assert.throws(() => crm.flows.report({ ...initial, message: 'Different' }), {
    status: 409,
  });
  assert.throws(
    () => crm.flows.report({ ...initial, reportId: 'stale', version: 0 }),
    { status: 409 },
  );
  assert.throws(() =>
    crm.flows.report({
      ...initial,
      reportId: 'bad-link',
      version: 1,
      sources: [{ label: 'Unsafe', url: 'javascript:alert(1)' }],
    }),
  );
  const proposal = crm.propose(
    change([
      {
        type: 'create_collection',
        id: 'contacts',
        name: 'Example contacts',
        fields: [],
      },
      {
        type: 'create_record',
        collectionId: 'contacts',
        collectionVersion: 1,
        title: 'Fictional Avery',
        values: {},
      },
    ]),
  );
  flow = crm.flows.report({
    id: flow.id,
    reportId: 'review-1',
    version: 1,
    stage: 'review',
    message: 'A collection and contact are ready',
    changeIds: [proposal.id],
  });
  assert.equal(flow.pendingCount, 1);
  assert.equal(flow.appliedCount, 0);
  assert.equal(crm.collections().length, 0);
  assert.throws(
    () =>
      crm.flows.report({
        id: flow.id,
        reportId: 'too-soon',
        version: 2,
        stage: 'complete',
        message: 'Done',
      }),
    /pending or rejected/,
  );
  crm.review(proposal.id, { version: 1, decision: 'approve' });
  flow = crm.flows.get(flow.id);
  assert.equal(flow.pendingCount, 0);
  assert.equal(flow.appliedCount, 2);
  assert.equal(flow.stage, 'review');
  flow = crm.flows.report({
    id: flow.id,
    reportId: 'complete-1',
    version: 2,
    stage: 'complete',
    message: 'Verified the applied contact and collection.',
  });
  assert.equal(flow.stage, 'complete');
  assert.equal(crm.flows.get(flow.id).updates.length, 3);
  const reopened = f.reopen().crm;
  assert.equal(
    reopened.flows.get(flow.id).sources[0].url,
    'https://example.com/studio',
  );
  assert.equal(reopened.export().agentFlows.updates.length, 3);
});
test('version 1 composable migration preserves schemas, records, proposals and activity while adding flow tables', (t) => {
  const f = fixture(t);
  f.store.create({ company: 'Fictional preserved job', stage: 'interested' });
  f.store.crm.apply(
    change([
      {
        type: 'create_collection',
        id: 'research',
        name: 'Research',
        fields: [],
      },
      {
        type: 'create_record',
        collectionId: 'research',
        collectionVersion: 1,
        title: 'Fictional finding',
        values: {},
      },
    ]),
  );
  const before = f.store.crm.export(),
    jobs = f.store.list();
  const db = new DatabaseSync(f.file);
  db.exec(
    'DROP TABLE crm_flow_updates; DROP TABLE crm_flows; UPDATE crm_meta SET version=1',
  );
  db.close();
  const store = f.reopen(),
    after = store.crm.export();
  for (const key of ['collections', 'records', 'views', 'changes', 'history'])
    assert.deepEqual(after[key], before[key]);
  assert.deepEqual(store.list(), jobs);
  assert.equal(store.crm.context().schemaVersion, 3);
  assert.deepEqual(after.agentFlows, { flows: [], updates: [] });
});
test('incremental history pages return every unseen change in order without gaps', (t) => {
  const { store } = fixture(t),
    crm = store.crm;
  crm.apply(
    change([
      { type: 'create_collection', id: 'notes', name: 'Notes', fields: [] },
    ]),
  );
  for (let i = 0; i < 7; i++)
    crm.apply(
      change([
        {
          type: 'create_record',
          collectionId: 'notes',
          collectionVersion: 1,
          title: `Example ${i}`,
          values: {},
        },
      ]),
    );
  const seen = [];
  let cursor = 1;
  while (true) {
    const page = crm.history({ after: cursor, limit: 2 });
    if (!page.length) break;
    seen.push(...page.map((e) => e.id));
    cursor = page.at(-1).id;
  }
  assert.deepEqual(seen, [2, 3, 4, 5, 6, 7, 8]);
});
