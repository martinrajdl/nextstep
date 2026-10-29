import { randomUUID, createHash } from 'node:crypto';
import { AppError } from './errors.mjs';

const fail = (message, status = 400) => {
  throw new AppError(message, status);
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const NOTE_LIMIT = 1048576;
export const noteOperations = {
  create_note: [
    'type',
    'id',
    'title',
    'body',
    'pinned',
    'links',
    'externalKey',
    'state',
  ],
  append_note: ['type', 'id', 'version', 'text', 'separator'],
  edit_note: ['type', 'id', 'version', 'find', 'replace'],
  update_note: [
    'type',
    'id',
    'version',
    'title',
    'body',
    'pinned',
    'links',
    'state',
  ],
};
export function noteTags(body) {
  const plain = body
    .replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '')
    .replace(/`+[^`]*`+/g, '');
  return [
    ...new Set(
      [
        ...plain.matchAll(/(?:^|\s)#([\p{L}\p{N}_-]+(?:\/[\p{L}\p{N}_-]+)*)/gu),
      ].map((m) => m[1].normalize('NFC').toLocaleLowerCase('en')),
    ),
  ];
}
export function createNotesStore(db, { getRecord, transaction }) {
  db.exec(`CREATE TABLE IF NOT EXISTS crm_note_library (id INTEGER PRIMARY KEY CHECK(id=1), collection_id TEXT NOT NULL UNIQUE REFERENCES crm_collections(id));
    CREATE TABLE IF NOT EXISTS crm_note_documents (note_id TEXT PRIMARY KEY REFERENCES crm_records(id), body TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, trashed_at TEXT, links TEXT NOT NULL DEFAULT '[]', tags TEXT NOT NULL DEFAULT '[]');
    CREATE TABLE IF NOT EXISTS crm_note_sync (note_id TEXT PRIMARY KEY REFERENCES crm_note_documents(note_id), dirty INTEGER NOT NULL DEFAULT 1, base_record TEXT, conflict_of TEXT);
    CREATE TABLE IF NOT EXISTS crm_notes_folder (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crm_note_files (note_id TEXT PRIMARY KEY REFERENCES crm_note_documents(note_id),filename TEXT NOT NULL UNIQUE,fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS crm_note_file_revisions (fingerprint TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS crm_notes_lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER NOT NULL DEFAULT 0);
    INSERT OR IGNORE INTO crm_notes_lease(id) VALUES(1);`);
  const libraryId = () =>
    db.prepare('SELECT collection_id FROM crm_note_library WHERE id=1').get()
      ?.collection_id ?? null;
  function library() {
    if (libraryId()) return libraryId();
    let id = 'notes',
      suffix = 1;
    while (db.prepare('SELECT 1 FROM crm_collections WHERE id=?').get(id))
      id = `notes_${++suffix}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO crm_collections VALUES (?,?,1,?,?)').run(
      id,
      JSON.stringify({
        name: 'Notes',
        description: 'Your writing, ideas and conversations.',
        color: '#9a7951',
        fields: [],
      }),
      now,
      now,
    );
    db.prepare('INSERT INTO crm_note_library VALUES(1,?)').run(id);
    return id;
  }
  function get(id) {
    const row = db
      .prepare('SELECT * FROM crm_note_documents WHERE note_id=?')
      .get(id);
    if (!row) fail('Note not found.', 404);
    const record = getRecord(id);
    return {
      ...record,
      body: row.body,
      pinned: Boolean(row.pinned),
      state: row.trashed_at
        ? 'trash'
        : record.archivedAt
          ? 'archived'
          : 'active',
      links: JSON.parse(row.links),
      tags: JSON.parse(row.tags),
      conflictOf:
        db
          .prepare('SELECT conflict_of FROM crm_note_sync WHERE note_id=?')
          .get(id)?.conflict_of ?? null,
    };
  }
  function validate(op, previous) {
    const title = op.title ?? previous?.title ?? 'Untitled';
    if (typeof title !== 'string' || title.length > 200 || /[\r\n]/.test(title))
      fail('Note titles support up to 200 characters.');
    const body = op.body ?? previous?.body ?? '';
    if (typeof body !== 'string' || Buffer.byteLength(body) > NOTE_LIMIT)
      fail('A note supports up to 1 MiB of Markdown.');
    const pinned = op.pinned ?? previous?.pinned ?? false;
    const state = op.state ?? previous?.state ?? 'active';
    if (
      typeof pinned !== 'boolean' ||
      !['active', 'archived', 'trash'].includes(state)
    )
      fail('Invalid note state.');
    const links = op.links ?? previous?.links ?? [];
    if (
      !Array.isArray(links) ||
      links.length > 100 ||
      new Set(links).size !== links.length ||
      links.some((id) => typeof id !== 'string' || id.length > 120)
    )
      fail('Use up to 100 distinct record links.');
    // Incoming notes can contain references to CRM records only present on another Mac.
    if (!op.remote) for (const id of links) getRecord(id);
    return {
      title: title.trim() || 'Untitled',
      body,
      pinned,
      state,
      links,
      tags: noteTags(body),
    };
  }
  function execute(op, { remote = false } = {}) {
    if (typeof op.id !== 'string' || !uuid.test(op.id))
      fail('Note ID must be a UUID.');
    const before = op.type === 'create_note' ? null : get(op.id);
    if (
      before &&
      (!Number.isInteger(op.version) || op.version !== before.version)
    )
      fail(
        'This note changed elsewhere. Your text is preserved; compare the current note before saving.',
        409,
      );
    if (op.type === 'append_note') {
      if (
        typeof op.text !== 'string' ||
        !op.text.length ||
        (op.separator !== undefined && typeof op.separator !== 'string')
      )
        fail('Append needs nonempty text and an optional string separator.');
      op = {
        ...op,
        body:
          before.body + (before.body ? (op.separator ?? '\n\n') : '') + op.text,
      };
    }
    if (op.type === 'edit_note') {
      if (
        typeof op.find !== 'string' ||
        !op.find.length ||
        typeof op.replace !== 'string'
      )
        fail('Edit needs a nonempty find string and a replacement string.');
      const at = before.body.indexOf(op.find);
      if (at < 0 || before.body.indexOf(op.find, at + 1) >= 0)
        fail(
          'The edit must match exactly once. Read the current note and choose a unique passage.',
          409,
        );
      op = {
        ...op,
        body:
          before.body.slice(0, at) +
          op.replace +
          before.body.slice(at + op.find.length),
      };
    }
    const data = validate({ ...op, remote }, before),
      now = new Date().toISOString();
    if (!before) {
      if (db.prepare('SELECT 1 FROM crm_records WHERE id=?').get(op.id))
        fail('This note identity already exists.', 409);
      if (
        op.externalKey != null &&
        (typeof op.externalKey !== 'string' || op.externalKey.length > 300)
      )
        fail('Invalid import identity.');
      const collectionId = library();
      if (
        op.externalKey &&
        db
          .prepare(
            'SELECT 1 FROM crm_records WHERE collection_id=? AND external_key=?',
          )
          .get(collectionId, op.externalKey)
      )
        fail('This note was already imported, including archived notes.', 409);
      db.prepare(
        "INSERT INTO crm_records(id,collection_id,title,data,external_key,version,created_at,updated_at,archived_at,position) VALUES(?,?,?,'{}',?,1,?,?,?,0)",
      ).run(
        op.id,
        collectionId,
        data.title,
        op.externalKey ?? null,
        now,
        now,
        data.state === 'archived' ? now : null,
      );
      db.prepare(
        'INSERT INTO crm_note_documents(note_id,body) VALUES(?,?)',
      ).run(op.id, data.body);
      db.prepare('INSERT INTO crm_note_sync(note_id,dirty) VALUES(?,?)').run(
        op.id,
        Number(!remote),
      );
    } else {
      db.prepare(
        'UPDATE crm_records SET title=?,version=version+1,updated_at=?,archived_at=? WHERE id=?',
      ).run(
        data.title,
        now,
        data.state === 'archived' ? before.archivedAt || now : null,
        op.id,
      );
    }
    db.prepare(
      'UPDATE crm_note_documents SET body=?,pinned=?,trashed_at=?,links=?,tags=? WHERE note_id=?',
    ).run(
      data.body,
      Number(data.pinned),
      data.state === 'trash' ? now : null,
      JSON.stringify(data.links),
      JSON.stringify(data.tags),
      op.id,
    );
    if (!remote) markDirty(op.id);
    return {
      action: op.type,
      entityType: 'note',
      entityId: op.id,
      before,
      after: get(op.id),
    };
  }
  function markDirty(id) {
    db.prepare('UPDATE crm_note_sync SET dirty=1 WHERE note_id=?').run(id);
  }
  function list({
    search = '',
    tag = '',
    state = 'active',
    linkedTo = '',
    limit = 100,
    offset = 0,
  } = {}) {
    if (
      typeof search !== 'string' ||
      search.length > 500 ||
      typeof tag !== 'string' ||
      tag.length > 200 ||
      !['active', 'archived', 'trash', 'all'].includes(state) ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 200 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      fail('Invalid notes query.');
    const terms = [],
      args = [];
    if (state !== 'all')
      terms.push(
        state === 'trash'
          ? 'n.trashed_at IS NOT NULL'
          : `n.trashed_at IS NULL AND r.archived_at IS ${state === 'active' ? '' : 'NOT '}NULL`,
      );
    if (search) {
      terms.push(
        '(instr(lower(r.title),lower(?))>0 OR instr(lower(n.body),lower(?))>0)',
      );
      args.push(search, search);
    }
    if (tag) {
      terms.push(
        "EXISTS (SELECT 1 FROM json_each(n.tags) WHERE value=? OR substr(value,1,length(?)+1)=?||'/')",
      );
      args.push(tag, tag, tag);
    }
    if (linkedTo) {
      terms.push('EXISTS (SELECT 1 FROM json_each(n.links) WHERE value=?)');
      args.push(linkedTo);
    }
    const where = terms.length ? `WHERE ${terms.join(' AND ')}` : '';
    const from = `FROM crm_note_documents n JOIN crm_records r ON r.id=n.note_id ${where}`;
    const rows = db
      .prepare(
        `SELECT r.id ${from} ORDER BY n.pinned DESC,r.updated_at DESC,r.id LIMIT ? OFFSET ?`,
      )
      .all(...args, limit, offset);
    return {
      notes: rows.map(({ id }) => {
        const { body, ...note } = get(id);
        return {
          ...note,
          preview: body.replace(/[#*\x60>\[\]]/g, '').slice(0, 180),
        };
      }),
      total: db.prepare(`SELECT count(*) AS n ${from}`).get(...args).n,
      tags: db
        .prepare(
          'SELECT DISTINCT j.value AS tag FROM crm_note_documents n JOIN crm_records r ON r.id=n.note_id,json_each(n.tags) j WHERE n.trashed_at IS NULL AND r.archived_at IS NULL ORDER BY j.value',
        )
        .all()
        .map((r) => r.tag),
      nextOffset:
        offset + rows.length <
        db.prepare(`SELECT count(*) AS n ${from}`).get(...args).n
          ? offset + rows.length
          : null,
      libraryId: libraryId(),
    };
  }
  const wire = (id) => {
    const n = get(id);
    return {
      id: n.id,
      title: n.title,
      body: n.body,
      pinned: n.pinned,
      state: n.state,
      links: n.links,
    };
  };
  const fingerprint = (n) =>
    createHash('sha256')
      .update(JSON.stringify([n.title, n.body, n.pinned, n.state, n.links]))
      .digest('hex');
  function syncSettings() {
    return JSON.parse(
      db.prepare('SELECT data FROM crm_notes_folder WHERE id=1').get()?.data ??
        '{"enabled":false}',
    );
  }
  function saveSettings(data) {
    db.prepare(
      'INSERT INTO crm_notes_folder VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    ).run(JSON.stringify(data));
  }
  function fileFor(id) {
    return db.prepare('SELECT * FROM crm_note_files WHERE note_id=?').get(id);
  }
  function rememberFile(id, filename, fingerprint) {
    db.prepare(
      'INSERT INTO crm_note_files VALUES(?,?,?) ON CONFLICT(note_id) DO UPDATE SET filename=excluded.filename,fingerprint=excluded.fingerprint',
    ).run(id, filename, fingerprint);
  }
  const knownFiles = () => db.prepare('SELECT * FROM crm_note_files').all();
  const seenRevision = (hash) =>
    Boolean(
      db
        .prepare('SELECT 1 FROM crm_note_file_revisions WHERE fingerprint=?')
        .get(hash),
    );
  const markSeen = (hash) =>
    db
      .prepare('INSERT OR IGNORE INTO crm_note_file_revisions VALUES(?)')
      .run(hash);
  const baseFor = (id) =>
    db.prepare('SELECT base_record FROM crm_note_sync WHERE note_id=?').get(id)
      ?.base_record ?? null;
  function incoming(remote, baseRecord, divergent = false) {
    return transaction(() => {
      if (!remote || !uuid.test(remote.id)) fail('Invalid note file.');
      validate({ ...remote, remote: true }, null);
      const row = db
        .prepare('SELECT * FROM crm_note_sync WHERE note_id=?')
        .get(remote.id);
      if (row && get(remote.id).collectionId !== libraryId())
        fail('Note file identity collision.', 409);
      if (row?.base_record && row.base_record === baseRecord) return;
      if (
        row &&
        (row.dirty || divergent) &&
        fingerprint(wire(remote.id)) !== fingerprint(remote)
      ) {
        // A durable, deterministic conflict copy makes retries safe and keeps the shared identity stable.
        const local = wire(remote.id),
          digest = createHash('sha256')
            .update(remote.id + fingerprint(local) + fingerprint(remote))
            .digest('hex');
        const copyId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
        if (!db.prepare('SELECT 1 FROM crm_records WHERE id=?').get(copyId)) {
          const diff = execute(
            {
              type: 'create_note',
              ...local,
              id: copyId,
              title: `${local.title.slice(0, 175)} (conflict copy)`,
            },
            { remote: true },
          );
          db.prepare(
            'UPDATE crm_note_sync SET dirty=1,conflict_of=? WHERE note_id=?',
          ).run(remote.id, copyId);
          logRemote(diff);
        }
      }
      if (!row || fingerprint(wire(remote.id)) !== fingerprint(remote)) {
        const diff = execute(
          {
            ...remote,
            type: row ? 'update_note' : 'create_note',
            version: row ? get(remote.id).version : undefined,
          },
          { remote: true },
        );
        logRemote(diff);
      }
      db.prepare(
        'UPDATE crm_note_sync SET dirty=0,base_record=? WHERE note_id=?',
      ).run(baseRecord, remote.id);
    });
  }
  function logRemote(diff) {
    db.prepare(
      'INSERT INTO crm_events(change_id,action,entity_type,entity_id,before_data,after_data,actor,created_at) VALUES(?,?,?,?,?,?,?,?)',
    ).run(
      `folder-${randomUUID()}`,
      diff.action,
      'note',
      diff.entityId,
      diff.before ? JSON.stringify(diff.before) : null,
      JSON.stringify(diff.after),
      'Folder sync',
      new Date().toISOString(),
    );
  }
  function pending() {
    return db
      .prepare(
        'SELECT note_id,base_record FROM crm_note_sync WHERE dirty=1 LIMIT 50',
      )
      .all()
      .map((row) => ({
        note: wire(row.note_id),
        version: get(row.note_id).version,
        baseRecord: row.base_record,
      }));
  }
  function acknowledge(id, expectedVersion, baseRecord) {
    transaction(() => {
      db.prepare(
        'UPDATE crm_note_sync SET base_record=?,dirty=? WHERE note_id=?',
      ).run(baseRecord, Number(get(id).version !== expectedVersion), id);
    });
  }
  function lease(owner) {
    const now = Date.now();
    return (
      db
        .prepare(
          'UPDATE crm_notes_lease SET owner=?,expires=? WHERE id=1 AND (expires<? OR owner=?)',
        )
        .run(owner, now + 180000, now, owner).changes > 0
    );
  }
  const release = (owner) =>
    db.prepare('UPDATE crm_notes_lease SET expires=0 WHERE owner=?').run(owner);
  const pendingCount = () =>
    db.prepare('SELECT count(*) AS n FROM crm_note_sync WHERE dirty=1').get().n;
  return {
    pendingCount,
    libraryId,
    get,
    list,
    execute,
    markDirty,
    wire,
    pending,
    incoming,
    acknowledge,
    syncSettings,
    saveSettings,
    fileFor,
    rememberFile,
    knownFiles,
    seenRevision,
    markSeen,
    baseFor,
    lease,
    release,
    export: () =>
      db
        .prepare('SELECT note_id FROM crm_note_documents')
        .all()
        .map((r) => get(r.note_id)),
  };
}
