import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  rmSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync,
  symlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openStore } from '../server/store.mjs';
import { createNotesSync, decodeNoteFile } from '../server/notes-sync.mjs';
import { noteTags } from '../server/notes-store.mjs';
const change = (ops) => ({
  id: randomUUID(),
  title: 'Fictional notes change',
  operations: ops,
});
const add = (crm, body = 'Example text', extra = {}) => {
  const id = randomUUID();
  crm.apply(
    change([
      { type: 'create_note', id, title: 'Example note', body, ...extra },
    ]),
  );
  return crm.notes.get(id);
};
const edit = (crm, n, extra) =>
  crm.apply(
    change([{ type: 'update_note', id: n.id, version: n.version, ...extra }]),
  );
const managers = new WeakMap();
function fixture(t) {
  const s = openStore(':memory:');
  managers.set(s.crm, []);
  t.after(() => {
    for (const sync of managers.get(s.crm)) sync.stop();
    s.close();
  });
  return s.crm;
}
function managedSync(crm, transport) {
  const sync = createNotesSync(crm.notes, transport);
  managers.get(crm).push(sync);
  return sync;
}

test('notes are opt-in, preserve Markdown whitespace, search nested tags and use one CRM identity', (t) => {
  const crm = fixture(t);
  assert.equal(crm.notes.libraryId(), null);
  assert.equal(crm.context().collections.length, 0);
  crm.apply(
    change([
      {
        type: 'create_collection',
        id: 'notes',
        name: 'Existing Notes collection',
        fields: [],
      },
    ]),
  );
  const n = add(
    crm,
    '  # Heading\n\n#Project/research\n\n```\n#ignore\n```\n`#also_ignore`  ',
  );
  assert.equal(n.collectionId, 'notes_2');
  assert.ok(n.body.startsWith('  '));
  assert.ok(n.body.endsWith('  '));
  assert.equal(crm.getRecord(n.id).id, n.id);
  assert.deepEqual(n.tags, ['project/research']);
  assert.equal(crm.notes.list({ tag: 'project' }).total, 1);
  assert.equal(crm.notes.list({ search: 'Heading' }).total, 1);
  assert.deepEqual(noteTags('#中文/研究 #One #one'), ['中文/研究', 'one']);
  assert.equal(crm.notes.list().notes[0].body, undefined);
});
test('preview, stale approval and invalid batches cannot partially write or queue cloud changes', (t) => {
  const crm = fixture(t),
    n = add(crm);
  crm.notes.acknowledge(n.id, n.version, 'v1');
  const input = change([
    { type: 'update_note', id: n.id, version: 1, body: 'Agent edit' },
  ]);
  crm.preview(input);
  assert.equal(crm.notes.get(n.id).body, n.body);
  assert.equal(crm.notes.pending().length, 0);
  crm.setPolicy({ version: crm.policy().version, reviewRequired: true });
  const p = crm.agentApply(input);
  assert.equal(p.status, 'pending');
  assert.equal(crm.notes.pending().length, 0);
  edit(crm, n, { body: 'Human edit' });
  assert.throws(
    () => crm.review(p.id, { version: p.version, decision: 'approve' }),
    /changed/,
  );
  assert.equal(crm.notes.get(n.id).body, 'Human edit');
  const fresh = crm.notes.get(n.id);
  assert.throws(
    () =>
      crm.apply(
        change([
          {
            type: 'update_note',
            id: n.id,
            version: fresh.version,
            body: 'Must roll back',
          },
          {
            type: 'update_note',
            id: randomUUID(),
            version: 1,
            body: 'Missing',
          },
        ]),
      ),
    /not found/,
  );
  assert.equal(crm.notes.get(n.id).body, 'Human edit');
  const approved = crm.agentApply(
    change([
      {
        type: 'update_note',
        id: n.id,
        version: fresh.version,
        body: 'Approved text',
      },
    ]),
  );
  crm.review(approved.id, { version: 1, decision: 'approve' });
  assert.equal(crm.notes.get(n.id).body, 'Approved text');
});
test('archive, trash, repeat import and generic record edits retain note identity and outbox', (t) => {
  const crm = fixture(t),
    n = add(crm, 'Original', { externalKey: 'markdown:example.md' });
  assert.throws(
    () => add(crm, 'Repeat', { externalKey: 'markdown:example.md' }),
    /already imported/,
  );
  edit(crm, n, { state: 'trash' });
  assert.equal(crm.notes.list().total, 0);
  assert.equal(crm.notes.list({ state: 'trash' }).total, 1);
  const trashed = crm.notes.get(n.id);
  edit(crm, trashed, { state: 'active' });
  const active = crm.notes.get(n.id);
  crm.notes.acknowledge(n.id, active.version, 'v1');
  crm.apply(
    change([
      {
        type: 'update_record',
        id: n.id,
        version: active.version,
        collectionVersion: 1,
        title: 'Renamed generically',
      },
    ]),
  );
  assert.equal(crm.notes.pending()[0].note.title, 'Renamed generically');
  assert.equal(crm.export().notes[0].body, 'Original');
});
test('additive migration and reopen preserve existing CRM records, history and note bodies', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-notes-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'test.sqlite');
  let s = openStore(path);
  const legacy = s.create({
    company: 'Fictional Example',
    notes: 'Keep inline notes',
  });
  const previousEvents = s.crm.history();
  const previousRecord = s.get(legacy.id);
  s.close();
  // Recreate the pre-notes schema: the existing CRM and compatibility tables remain intact.
  const old = new DatabaseSync(path);
  for (const table of ['crm_note_file_revisions','crm_note_files','crm_note_sync','crm_note_documents','crm_note_library','crm_notes_folder','crm_notes_lease']) old.exec(`DROP TABLE ${table}`);
  old.close();
  s = openStore(path);
  assert.deepEqual(s.get(legacy.id), previousRecord);
  assert.deepEqual(s.crm.history(), previousEvents);
  assert.equal(s.crm.notes.libraryId(), null);
  const n = add(s.crm, 'Large document\n' + 'x'.repeat(22000));
  const events = s.crm.history();
  s.close();
  s = openStore(path);
  assert.equal(s.get(legacy.id).notes, 'Keep inline notes');
  assert.equal(s.crm.notes.get(n.id).body, n.body);
  assert.deepEqual(s.crm.history(), events);
  s.close();
});

function folderFixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'nextstep-note-files-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function folderSync(crm) {
  return managedSync(crm, { canChooseFolder: true });
}
test('two stores sync portable Markdown, preserve offline conflicts and propagate trash', async (t) => {
  const a = fixture(t),
    b = fixture(t),
    folder = folderFixture(t),
    sa = folderSync(a),
    sb = folderSync(b);
  await sa.connect(folder);
  await sb.connect(folder);
  const n = add(a, 'Original');
  await sa.configure({ enabled: true });
  await sa.run();
  await sb.configure({ enabled: true });
  await sb.run();
  assert.equal(b.notes.get(n.id).body, 'Original');
  const root = join(folder, 'Nextstep Notes');
  const content = readFileSync(join(root, `${n.id}.md`), 'utf8');
  assert.match(content, /# Example note/);
  assert.equal(decodeNoteFile(content, `${n.id}.md`).note.body, 'Original');
  edit(a, a.notes.get(n.id), { body: 'Offline A' });
  edit(b, b.notes.get(n.id), { body: 'Offline B' });
  await sa.run();
  await sb.run();
  await sb.run();
  await sa.run();
  assert.ok(a.notes.export().some((n) => n.body === 'Offline A'));
  assert.ok(a.notes.export().some((n) => n.body === 'Offline B'));
  assert.ok(b.notes.export().some((n) => n.body === 'Offline A'));
  assert.ok(b.notes.export().some((n) => n.body === 'Offline B'));
  edit(a, a.notes.get(n.id), { state: 'trash' });
  await sa.run();
  await sb.run();
  assert.equal(b.notes.get(n.id).state, 'trash');
});
test('external Markdown edits and new files import, missing files do not delete notes', async (t) => {
  const crm = fixture(t),
    folder = folderFixture(t),
    sync = folderSync(crm);
  await sync.connect(folder);
  const n = add(crm, 'Original');
  await sync.configure({ enabled: true });
  await sync.run();
  const root = join(folder, 'Nextstep Notes'),
    path = join(root, `${n.id}.md`);
  writeFileSync(
    path,
    readFileSync(path, 'utf8').replace('Original', 'Edited in another editor'),
  );
  await sync.run();
  assert.equal(crm.notes.get(n.id).body, 'Edited in another editor');
  writeFileSync(
    join(root, 'example.md'),
    '# Imported title\n\nExternal writing #research',
  );
  await sync.run();
  const imported = crm.notes.list({ search: 'External writing' });
  assert.equal(imported.total, 1);
  assert.ok(
    readFileSync(join(root, 'example.md'), 'utf8').startsWith(
      '---\nnextstep: ',
    ),
  );
  await sync.run();
  assert.equal(crm.notes.list({ search: 'External writing' }).total, 1);
  unlinkSync(path);
  await sync.run();
  assert.equal(crm.notes.get(n.id).body, 'Edited in another editor');
  assert.equal(sync.status().missingCount, 1);
  assert.equal(sync.status().state, 'missing');
  assert.throws(() => readFileSync(path));
  await sync.configure({ enabled: true, restoreMissing: true });
  await sync.run();
  assert.match(readFileSync(path, 'utf8'), /Edited in another editor/);
});
test('folder sync refuses symbolic links and unsafe renderer configuration without losing pending work', async (t) => {
  const crm = fixture(t),
    folder = folderFixture(t),
    sync = folderSync(crm);
  await sync.connect(folder);
  const n = add(crm);
  await sync.configure({ enabled: true });
  await sync.run();
  const root = join(folder, 'Nextstep Notes');
  writeFileSync(join(folder, 'private.txt'), 'Keep private');
  symlinkSync(join(folder, 'private.txt'), join(root, 'unsafe.md'));
  edit(crm, crm.notes.get(n.id), { body: 'Pending local text' });
  await sync.run();
  assert.equal(sync.status().state, 'error');
  assert.equal(crm.notes.pendingCount(), 1);
  assert.equal(
    readFileSync(join(folder, 'private.txt'), 'utf8'),
    'Keep private',
  );
  await assert.rejects(
    () => sync.configure({ enabled: true, folder: '/arbitrary' }),
    /Invalid folder/,
  );
});
test('concurrent folder writes retain every version in portable immutable recovery snapshots', async (t) => {
  const a = fixture(t),
    b = fixture(t),
    folder = folderFixture(t),
    sa = folderSync(a),
    sb = folderSync(b);
  await sa.connect(folder);
  await sb.connect(folder);
  const n = add(a, 'Base');
  await sa.configure({ enabled: true });
  await sa.run();
  await sb.configure({ enabled: true });
  await sb.run();
  edit(a, a.notes.get(n.id), { body: 'Concurrent A' });
  edit(b, b.notes.get(n.id), { body: 'Concurrent B' });
  await Promise.all([sa.run(), sb.run()]);
  await sa.run();
  await sb.run();
  await sa.run();
  const root = join(folder, 'Nextstep Notes', '.nextstep-history');
  const snapshots = readdirSync(root).map((f) =>
    readFileSync(join(root, f), 'utf8'),
  );
  assert.ok(snapshots.some((s) => s.includes('Concurrent A')));
  assert.ok(snapshots.some((s) => s.includes('Concurrent B')));
  const c = fixture(t),
    sc = folderSync(c);
  await sc.connect(folder);
  await sc.configure({ enabled: true });
  await sc.run();
  assert.ok(c.notes.export().some((n) => n.body === 'Concurrent A'));
  assert.ok(c.notes.export().some((n) => n.body === 'Concurrent B'));
});
test('acknowledgment does not clear edits made while an upload was in flight', (t) => {
  const crm = fixture(t),
    n = add(crm);
  edit(crm, n, { body: 'Newer text' });
  crm.notes.acknowledge(n.id, n.version, 'v1');
  assert.equal(crm.notes.pending().length, 1);
  assert.equal(crm.notes.get(n.id).body, 'Newer text');
});


test('passage edits reject ambiguous matches and oversized appends roll back the whole change', t => {
  const crm=fixture(t), n=add(crm,'Same passage. Same passage.');
  assert.throws(()=>crm.apply(change([{type:'edit_note',id:n.id,version:n.version,find:'Same passage.',replace:'Changed.'}])),/exactly once/);
  assert.deepEqual(crm.notes.get(n.id),n);
  assert.throws(()=>crm.apply(change([{type:'update_note',id:n.id,version:n.version,pinned:true},{type:'append_note',id:n.id,version:n.version+1,text:'x'.repeat(1048576)}])),/1 MiB/);
  assert.deepEqual(crm.notes.get(n.id),n);
});
