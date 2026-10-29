import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  realpath,
  lstat,
  readFile,
  readdir,
  writeFile,
  rename,
  unlink,
  link,
} from 'node:fs/promises';
import { join, basename, resolve } from 'node:path';
import { AppError } from './errors.mjs';
const digest = (text) => createHash('sha256').update(text).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function encodeNoteFile(note, parent = null) {
  return `---\nnextstep: ${JSON.stringify({ version: 1, id: note.id, pinned: note.pinned, state: note.state, links: note.links, parent })}\n---\n# ${note.title}\n\n${note.body}`;
}
export function decodeNoteFile(text, filename) {
  let meta = null,
    content = text;
  const header = text.match(/^---\r?\nnextstep: ([^\n]+)\r?\n---\r?\n/);
  if (header) {
    try {
      meta = JSON.parse(header[1]);
    } catch {
      throw new Error(`Invalid note metadata in ${filename}.`);
    }
    content = text.slice(header[0].length);
  }
  if (meta && (meta.version !== 1 || !uuid.test(meta.id)))
    throw new Error(`Unsupported note format in ${filename}.`);
  const heading = content.match(/^# ([^\r\n]*)\r?\n(?:\r?\n)?/),
    h = digest(filename.toLowerCase());
  return {
    note: {
      id:
        meta?.id ??
        `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`,
      title: heading?.[1] || basename(filename, '.md').slice(0, 200),
      body: heading ? content.slice(heading[0].length) : content,
      pinned: meta?.pinned ?? false,
      state: meta?.state ?? 'active',
      links: meta?.links ?? [],
    },
    parent: meta?.parent ?? null,
  };
}
async function safeRead(folder, name) {
  if (basename(name) !== name) throw new Error('Invalid note filename.');
  const path = join(folder, name),
    info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 2097152)
    throw new Error(
      `Cannot sync ${name}: use a regular Markdown file under 2 MiB.`,
    );
  return readFile(path, 'utf8');
}
async function present(path) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
export function createNotesSync(notes, { canChooseFolder = false } = {}) {
  let running = null,
    stopped = false,
    state = 'off',
    message = '',
    lastSyncedAt = null,
    missing = [];
  const owner = randomUUID();
  function status() {
    if (stopped)
      return {
        state: 'off',
        enabled: false,
        available: canChooseFolder,
        pending: 0,
        folder: null,
        message: '',
        lastSyncedAt,
      };
    const c = notes.syncSettings();
    return {
      state: !canChooseFolder ? 'unavailable' : !c.enabled ? 'off' : state,
      available: canChooseFolder,
      enabled: c.enabled,
      folder: c.folder ?? null,
      pending: notes.pendingCount(),
      message,
      lastSyncedAt,
      missingCount: missing.length,
    };
  }
  const active = () =>
    canChooseFolder && !stopped && notes.syncSettings().enabled;
  async function connect(selected) {
    if (!canChooseFolder)
      throw new AppError('Choose a notes folder in the desktop app.', 409);
    if (running) await running;
    const chosen = await realpath(selected),
      root =
        basename(chosen) === 'Nextstep Notes'
          ? chosen
          : join(chosen, 'Nextstep Notes'),
      c = notes.syncSettings();
    if (c.folder && c.folder !== root)
      throw new AppError(
        'Use a separate local database to connect a different notes folder. Your current notes remain safe.',
        409,
      );
    await mkdir(root, { recursive: true });
    if ((await lstat(root)).isSymbolicLink())
      throw new AppError(
        'Choose a real notes folder rather than a symbolic link.',
      );
    notes.saveSettings({ ...c, folder: root, enabled: false });
    state = 'off';
    message = '';
    return status();
  }
  async function configure(input) {
    if (
      Object.keys(input).some(
        (k) => !['enabled', 'restoreMissing'].includes(k),
      ) ||
      typeof input.enabled !== 'boolean' ||
      (input.restoreMissing !== undefined &&
        typeof input.restoreMissing !== 'boolean')
    )
      throw new AppError('Invalid folder sync settings.');
    const c = notes.syncSettings();
    if (input.enabled && (!canChooseFolder || !c.folder))
      throw new AppError(
        'Choose a notes folder in the desktop app first.',
        409,
      );
    if (input.restoreMissing) for (const id of missing) notes.markDirty(id);
    notes.saveSettings({ ...c, enabled: input.enabled });
    state = input.enabled ? 'queued' : 'off';
    message = '';
    if (input.enabled) void run();
    return status();
  }
  async function run() {
    if (running) return running;
    if (!active()) return status();
    running = (async () => {
      if (!notes.lease(owner)) return status();
      try {
        state = 'syncing';
        message = '';
        missing = [];
        const root = notes.syncSettings().folder;
        if (
          !root ||
          !(await lstat(root)).isDirectory() ||
          (await realpath(root)) !== resolve(root)
        )
          throw new Error(
            'The notes folder is unavailable. Reconnect its drive or sync service; your local notes are safe.',
          );
        const recovery = join(root, '.nextstep-history');
        await mkdir(recovery, { recursive: true });
        if ((await lstat(recovery)).isSymbolicLink())
          throw new Error(
            'The note recovery folder must not be a symbolic link.',
          );
        const journal = async (text) => {
          const { note } = decodeNoteFile(text, 'snapshot.md'),
            hash = digest(text),
            name = `${note.id}--${hash}.md`;
          try {
            await writeFile(join(recovery, name), text, {
              flag: 'wx',
              mode: 0o600,
            });
          } catch (e) {
            if (e.code !== 'EEXIST') throw e;
            if (digest(await safeRead(recovery, name)) !== hash)
              throw new Error(
                'A note recovery snapshot changed. Sync is paused.',
              );
          }
          return hash;
        };
        // Immutable revisions preserve both sides even if a cloud service replaces a working file.
        const revisions = [];
        for (const name of (await readdir(recovery)).filter((n) =>
          /^[a-f0-9-]{36}--[a-f0-9]{64}\.md$/i.test(n),
        )) {
          if (!active()) return status();
          const hash = name.slice(38, -3);
          if (notes.seenRevision(hash)) continue;
          const text = await safeRead(recovery, name);
          if (digest(text) !== hash)
            throw new Error(
              'A note recovery snapshot failed its integrity check.',
            );
          revisions.push({ ...decodeNoteFile(text, name), hash });
        }
        revisions.sort((a, b) => a.hash.localeCompare(b.hash));
        while (revisions.length) {
          const index = revisions.findIndex(
            (r) =>
              !r.parent ||
              notes.seenRevision(r.parent) ||
              !revisions.some((p) => p.hash === r.parent),
          );
          if (index < 0)
            throw new Error('The note revision history contains a cycle.');
          const r = revisions.splice(index, 1)[0],
            base = notes.baseFor(r.note.id);
          notes.incoming(r.note, r.hash, Boolean(base && r.parent !== base));
          notes.markSeen(r.hash);
        }
        const ids = new Set();
        for (const filename of (await readdir(root)).filter(
          (n) => n.toLowerCase().endsWith('.md') && !n.startsWith('.'),
        )) {
          if (!active()) return status();
          const text = await safeRead(root, filename),
            hash = digest(text),
            { note } = decodeNoteFile(text, filename);
          if (ids.has(note.id))
            throw new Error(
              'Two Markdown files contain the same note ID. Keep both files and resolve the duplicate before syncing.',
            );
          ids.add(note.id);
          const known = notes.fileFor(note.id);
          if (!notes.seenRevision(hash)) {
            const foreign =
              !text.startsWith('---\nnextstep: ') &&
              !text.startsWith('---\r\nnextstep: ');
            const snapshot = foreign
              ? encodeNoteFile(note, notes.baseFor(note.id))
              : text;
            const snapshotHash = await journal(snapshot);
            if (!active()) return status();
            notes.incoming(note, snapshotHash);
            notes.markSeen(snapshotHash);
            notes.markSeen(hash);
            if (foreign) notes.markDirty(note.id);
          }
          notes.rememberFile(note.id, filename, hash);
          if (notes.baseFor(note.id) !== hash && known?.fingerprint === hash)
            notes.markDirty(note.id);
        }
        missing = notes
          .knownFiles()
          .filter((f) => !ids.has(f.note_id))
          .map((f) => f.note_id);
        for (const pending of notes.pending()) {
          if (!active()) return status();
          const mapping = notes.fileFor(pending.note.id),
            filename = mapping?.filename ?? `${pending.note.id}.md`;
          const text = encodeNoteFile(pending.note, pending.baseRecord),
            hash = await journal(text);
          if (!active()) return status();
          notes.markSeen(hash);
          const target = join(root, filename),
            exists = await present(target);
          if (exists) {
            const current = await safeRead(root, filename),
              currentHash = digest(current);
            if (currentHash !== mapping?.fingerprint) {
              notes.incoming(
                decodeNoteFile(current, filename).note,
                currentHash,
              );
              continue;
            }
          }
          const temp = join(root, `.nextstep-${randomUUID()}.tmp`);
          try {
            await writeFile(temp, text, { flag: 'wx', mode: 0o600 });
            if (
              exists &&
              digest(await safeRead(root, filename)) !== mapping?.fingerprint
            )
              continue;
            if (exists) await rename(temp, target);
            else {
              try {
                await link(temp, target);
              } catch (e) {
                if (e.code === 'EEXIST') continue;
                throw e;
              }
            }
          } finally {
            await unlink(temp).catch((e) => {
              if (e.code !== 'ENOENT') throw e;
            });
          }
          if (!active()) return status();
          notes.rememberFile(pending.note.id, filename, hash);
          notes.acknowledge(pending.note.id, pending.version, hash);
          ids.add(pending.note.id);
        }
        missing = notes
          .knownFiles()
          .filter((f) => !ids.has(f.note_id))
          .map((f) => f.note_id);
        state = missing.length
          ? 'missing'
          : notes.pendingCount()
            ? 'queued'
            : 'synced';
        lastSyncedAt = new Date().toISOString();
        if (missing.length)
          message =
            'Some Markdown files are missing. Their notes are kept locally. Restore the files or move the notes to Trash in Nextstep.';
      } catch (e) {
        state = 'error';
        message =
          e instanceof Error
            ? e.message
            : 'Folder sync failed. Your local notes are safe.';
      } finally {
        if (!stopped) notes.release(owner);
      }
      return status();
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }
  const timer = setInterval(() => void run(), 5000);
  timer.unref();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    notes.release(owner);
  };
  return {
    status,
    connect,
    configure,
    run,
    stop,
    async close() {
      stop();
      if (running) await running;
    },
  };
}
