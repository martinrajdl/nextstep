import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  Cloud,
  FileText,
  Hash,
  Pin,
  Plus,
  Search,
  Trash2,
  X,
  ArrowLeft,
  Upload,
  Link2,
} from 'lucide-react';
import AppButton from '@/components/app-button';
import { Input } from '@/components/ui/input';
import { request } from '@/lib/model';
import { applyChange, dateTime, errorMessage } from '@/lib/crm';
import type { Note, NotesPage, NotesSync } from '@/lib/notes';
import NoteEditor from './note-editor';
import Modal from './modal';
import './notes.css';

export default function NotesWorkspace({
  revision,
  onChanged,
  onRecord,
}: {
  revision: number;
  onChanged: () => Promise<void>;
  onRecord: (id: string) => void;
}) {
  const [page, setPage] = useState<NotesPage>({
      notes: [],
      total: 0,
      tags: [],
      libraryId: null,
    }),
    [selected, setSelected] = useState<Note | null>(null),
    [search, setSearch] = useState(''),
    [tag, setTag] = useState(''),
    [scope, setScope] = useState('active'),
    [error, setError] = useState(''),
    [focus, setFocus] = useState(false),
    [sync, setSync] = useState<NotesSync | null>(null),
    [syncOpen, setSyncOpen] = useState(false),
    [backlinks, setBacklinks] = useState<{ id: string; title: string }[]>([]);
  const [listLoaded, setListLoaded] = useState(false);
  const [offset, setOffset] = useState(0),
    [loading, setLoading] = useState(false);
  const canLeave = useRef<() => Promise<boolean>>(async () => true),
    selectedRef = useRef(selected);
  useLayoutEffect(() => {
    selectedRef.current = selected;
  });
  const query = new URLSearchParams(location.hash.split('?')[1]);
  const linkedTo = query.get('linkedTo') || '';
  const listSequence = useRef(0);
  const load = useCallback(async () => {
    const sequence = ++listSequence.current;
    try {
      const params = new URLSearchParams({
        search,
        tag,
        state: scope,
        offset: String(offset),
        ...(linkedTo ? { linkedTo } : {}),
      });
      const [data, status] = await Promise.all([
        request<NotesPage>(`/api/notes?${params}`),
        request<NotesSync>('/api/notes/sync'),
      ]);
      if (sequence !== listSequence.current) return;
      setPage(data);
      setListLoaded(true);
      setSync(status);
      if (selectedRef.current) {
        const note = await request<Note>(
          `/api/notes/${selectedRef.current.id}`,
        );
        if (
          sequence === listSequence.current &&
          selectedRef.current?.id === note.id
        )
          setSelected(note);
      }
    } catch (e) {
      if (sequence === listSequence.current) setError(errorMessage(e));
    }
  }, [search, tag, scope, offset, linkedTo]);
  useEffect(() => {
    const timer = setTimeout(() => void load(), 180);
    return () => clearTimeout(timer);
  }, [load, revision]);
  useEffect(() => {
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, [load]);
  async function choose(id: string) {
    if (!(await canLeave.current())) return;
    setLoading(true);
    try {
      const note = await request<Note>(`/api/notes/${id}`);
      setSelected(note);
      history.replaceState(null, '', `/#/notes?note=${id}`);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }
  const chooseRef = useRef(choose);
  useLayoutEffect(() => {
    chooseRef.current = choose;
  });
  useEffect(() => {
    const open = () => {
      const id = new URLSearchParams(location.hash.split('?')[1]).get('note');
      if (id) void chooseRef.current(id);
    };
    open();
    window.addEventListener('nextstep:notes-route', open);
    return () => window.removeEventListener('nextstep:notes-route', open);
  }, []);
  async function create(
    body = '',
    title = 'Untitled',
    links = linkedTo ? [linkedTo] : [],
    externalKey?: string,
  ) {
    if (!(await canLeave.current())) return;
    try {
      const id = crypto.randomUUID();
      await applyChange('Create note', [
        {
          type: 'create_note',
          id,
          title,
          body,
          links,
          ...(externalKey ? { externalKey } : {}),
        },
      ]);
      await choose(id);
      await Promise.all([load(), onChanged()]);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const createRef = useRef(create);
  useLayoutEffect(() => {
    createRef.current = create;
  });
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === 'n' &&
        !event.shiftKey &&
        !document.querySelector('[role=dialog]')
      ) {
        event.preventDefault();
        void createRef.current();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const selectedId = selected?.id;
  useEffect(() => {
    let cancelled = false;
    if (selectedId)
      void request<NotesPage>(`/api/notes?linkedTo=${selectedId}`)
        .then((r) => {
          if (!cancelled) setBacklinks(r.notes);
        })
        .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, revision]);
  async function openTarget(id: string) {
    try {
      await request<Note>(`/api/notes/${id}`);
      await choose(id);
    } catch {
      if (await canLeave.current()) onRecord(id);
    }
  }
  const saved = (note: Note) => {
    setSelected((current) => (current?.id === note.id ? note : current));
    void load();
  };
  return (
    <div
      className={`notes-workspace${selected ? ' has-note' : ''}${focus ? ' is-focused' : ''}`}
    >
      <aside className="notes-browser" aria-label="Notes library">
        <header>
          <div>
            <span className="crm-eyebrow">YOUR NOTEBOOK</span>
            <h1>Notes{listLoaded && <span>{page.total}</span>}</h1>
          </div>
          <AppButton
            aria-label="New note"
            title="New note · ⌘N"
            className="crm-icon-button"
            onClick={() => void create()}
          >
            <Plus size={20} />
          </AppButton>
        </header>
        <div className="notes-search">
          <Search size={15} />
          <Input
            aria-label="Search notes"
            placeholder="Search your notes…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOffset(0);
            }}
          />
        </div>
        <div className="notes-scopes" aria-label="Note filters">
          {[
            { id: 'active', label: 'All notes', icon: FileText },
            { id: 'archived', label: 'Archive', icon: Archive },
            { id: 'trash', label: 'Trash', icon: Trash2 },
          ].map((item) => (
            <AppButton
              key={item.id}
              aria-pressed={scope === item.id}
              onClick={() => {
                setScope(item.id);
                setOffset(0);
              }}
            >
              <item.icon size={14} />
              {item.label}
            </AppButton>
          ))}
        </div>
        {page.tags.length > 0 && (
          <div className="notes-tags" aria-label="Tags">
            <AppButton
              aria-pressed={!tag}
              onClick={() => {
                setTag('');
                setOffset(0);
              }}
            >
              <Hash size={12} />
              All tags
            </AppButton>
            {page.tags.map((t) => (
              <AppButton
                key={t}
                aria-pressed={tag === t}
                onClick={() => {
                  setTag(t);
                  setOffset(0);
                }}
              >
                #{t}
              </AppButton>
            ))}
          </div>
        )}
        {linkedTo && (
          <p className="crm-hint">
            <Link2 size={12} /> Notes linked to this record
          </p>
        )}
        <div className="notes-list" aria-label="Note list">
          {page.notes.map((note) => (
            <AppButton
              key={note.id}
              className={selected?.id === note.id ? 'is-selected' : ''}
              aria-current={selected?.id === note.id ? 'true' : undefined}
              onClick={() => void choose(note.id)}
            >
              <strong>
                {note.pinned && <Pin size={12} />} {note.title}
              </strong>
              <p>{note.preview || 'Your next idea starts here.'}</p>
              <small>
                {dateTime(note.updatedAt)}
                {note.tags.length > 0 && <span> · #{note.tags[0]}</span>}
              </small>
            </AppButton>
          ))}
          {!page.notes.length && (
            <div className="notes-list-empty">
              <FileText size={23} />
              <p>
                {!listLoaded
                  ? 'Loading notes…'
                  : search || tag
                    ? 'No matching notes.'
                    : scope === 'trash'
                      ? 'Nothing in the trash.'
                      : scope === 'archived'
                        ? 'No archived notes.'
                        : 'A place for your thoughts.'}
              </p>
              {listLoaded && scope === 'active' && !search && !tag && (
                <AppButton
                  className="crm-text-button"
                  onClick={() => void create()}
                >
                  Write your first note
                </AppButton>
              )}
            </div>
          )}
          {page.total > 100 && (
            <div className="notes-pagination">
              <AppButton
                disabled={!offset}
                onClick={() => setOffset(Math.max(0, offset - 100))}
              >
                Previous
              </AppButton>
              <span>
                {offset + 1}–{Math.min(offset + 100, page.total)}
              </span>
              <AppButton
                disabled={offset + 100 >= page.total}
                onClick={() => setOffset(offset + 100)}
              >
                Next
              </AppButton>
            </div>
          )}
        </div>
        <footer>
          <AppButton
            className="notes-cloud-button"
            onClick={() => setSyncOpen(true)}
          >
            <Cloud size={16} />
            <span>
              {sync?.enabled
                ? sync.state === 'synced'
                  ? 'Folder · Up to date'
                  : sync.state === 'error'
                    ? 'Folder · Needs attention'
                    : sync.state === 'syncing'
                      ? 'Folder · Syncing…'
                      : 'Folder · Changes queued'
                : 'Folder sync'}
              <small>
                {sync?.enabled
                  ? 'Notes only'
                  : 'iCloud Drive or your own folder'}
              </small>
            </span>
          </AppButton>
          <label className="notes-import">
            <Upload size={14} />
            <span>Import Markdown</span>
            <input
              type="file"
              accept=".md,.markdown,.txt"
              aria-label="Import Markdown"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > 1048576) {
                    setError('A note supports up to 1 MiB.');
                    return;
                  }
                  void file
                    .text()
                    .then((text) => {
                      if (window.confirm(`Import ${file.name} as a new note?`))
                        return create(
                          text,
                          file.name.replace(/\.(md|markdown|txt)$/i, ''),
                          [],
                          `markdown:${file.name.slice(0, 250)}`,
                        );
                    })
                    .catch((e) => setError(errorMessage(e)));
                }
                event.target.value = '';
              }}
            />
          </label>
        </footer>
      </aside>
      <section className="notes-writing" aria-label="Writing area">
        {error && (
          <div className="crm-error" role="alert">
            {error}
            <AppButton
              className="crm-text-button"
              onClick={() => {
                setError('');
                void load();
              }}
            >
              Retry
            </AppButton>
          </div>
        )}
        {selected ? (
          <>
            <AppButton
              className="notes-back crm-text-button"
              onClick={() =>
                void canLeave.current().then((ok) => {
                  if (ok) setSelected(null);
                })
              }
            >
              <ArrowLeft size={14} />
              All notes
            </AppButton>
            <NoteEditor
              key={selected.id}
              note={selected}
              onSaved={saved}
              canLeave={canLeave}
              onOpen={(id) => void openTarget(id)}
              focus={focus}
              onFocus={() => setFocus(!focus)}
            />
            {backlinks.length > 0 && (
              <div className="notes-backlinks">
                <span>LINKED FROM</span>
                {backlinks.map((n) => (
                  <AppButton
                    className="crm-text-button"
                    key={n.id}
                    onClick={() => void choose(n.id)}
                  >
                    <Link2 size={13} />
                    {n.title}
                  </AppButton>
                ))}
              </div>
            )}
          </>
        ) : (
          <div className="notes-welcome">
            <div>
              <FileText size={31} />
            </div>
            <span className="crm-eyebrow">SPACE TO THINK</span>
            <h2>
              A thought. A conversation.
              <br />A place to start.
            </h2>
            <p>
              Write naturally, connect your ideas, and keep the details close to
              your work.
            </p>
            <AppButton
              className="crm-button crm-button-primary"
              disabled={loading}
              onClick={() => void create()}
            >
              <Plus size={16} />
              New note
            </AppButton>
            <small>Markdown supported · Saved to your selected database</small>
          </div>
        )}
      </section>
      {syncOpen && (
        <Modal
          title="Sync your notes"
          subtitle="Beta · Markdown files in a folder you own"
          onClose={() => setSyncOpen(false)}
        >
          <div className="crm-form-body">
            <p>
              Folder sync is in beta. Choose a folder in your own iCloud Drive,
              or another synced location. Nextstep saves individual Markdown
              files in a Nextstep Notes subfolder. No Nextstep account or
              developer cloud container is involved.
            </p>
            <p>
              Notes, tags, links, pin state and trash are included. CRM records,
              proposals and your local database stay here.
            </p>
            {!sync?.available && (
              <p className="crm-hint">
                Choose a folder in the desktop app to sync. You can keep writing
                locally here.
              </p>
            )}
            {sync?.message && (
              <p className="crm-error" role="alert">
                {sync.message}
              </p>
            )}
            {sync?.folder && (
              <label htmlFor="notes-folder">
                Notes folder
                <Input
                  id="notes-folder"
                  aria-label="Notes folder"
                  readOnly
                  value={sync.folder}
                />
              </label>
            )}
            {sync?.available && !sync?.folder && (
              <AppButton
                className="crm-button"
                onClick={() =>
                  void window.nextstepDesktop
                    ?.chooseNotesFolder()
                    .then((result) => {
                      if (result) setSync(result);
                    })
                    .catch((e) =>
                      setSync((current) =>
                        current
                          ? { ...current, message: errorMessage(e) }
                          : current,
                      ),
                    )
                }
              >
                Choose folder…
              </AppButton>
            )}
            {sync?.lastSyncedAt && (
              <p>Last checked {dateTime(sync.lastSyncedAt)}</p>
            )}
            <p className="crm-hint">
              Nextstep checks files while it is open. Your cloud service
              controls when files reach other devices. Keep this folder
              downloaded on each Mac. Conflicting text is preserved in recovery
              copies; removing a file does not delete its local note. Use Trash
              in Nextstep to sync a removal.
            </p>
          </div>
          <footer>
            <AppButton
              className="crm-button"
              onClick={() => setSyncOpen(false)}
            >
              <X size={14} />
              Close
            </AppButton>
            {sync?.enabled && (
              <AppButton
                className="crm-button"
                onClick={() =>
                  void request<NotesSync>('/api/notes/sync/run', 'POST', {})
                    .then(setSync)
                    .then(() => load())
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                Sync now
              </AppButton>
            )}
            {Boolean(sync?.missingCount) && (
              <AppButton
                className="crm-button"
                onClick={() =>
                  void request<NotesSync>('/api/notes/sync', 'PATCH', {
                    enabled: true,
                    restoreMissing: true,
                  })
                    .then(setSync)
                    .catch((e) => setError(errorMessage(e)))
                }
              >
                Restore missing files
              </AppButton>
            )}
            <AppButton
              className="crm-button crm-button-primary"
              disabled={!sync?.enabled && (!sync?.available || !sync?.folder)}
              onClick={() =>
                void request<NotesSync>('/api/notes/sync', 'PATCH', {
                  enabled: !sync?.enabled,
                })
                  .then(setSync)
                  .catch((e) =>
                    setSync((current) =>
                      current
                        ? { ...current, message: errorMessage(e) }
                        : current,
                    ),
                  )
              }
            >
              {sync?.enabled ? 'Disable sync' : 'Enable folder sync'}
            </AppButton>
          </footer>
        </Modal>
      )}
    </div>
  );
}
