import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  Archive,
  FileText,
  Hash,
  Pin,
  Plus,
  Search,
  Trash2,
  ArrowLeft,
  Upload,
  Link2,
} from 'lucide-react';
import AppButton from '@/components/app-button';
import { Input } from '@/components/ui/input';
import { request } from '@/lib/model';
import { applyChange, dateTime, errorMessage } from '@/lib/crm';
import type { Note, NotesPage } from '@/lib/notes';
import NoteEditor from './note-editor';
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
      const data = await request<NotesPage>(`/api/notes?${params}`);
      if (sequence !== listSequence.current) return;
      setPage(data);
      setListLoaded(true);
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
            <h1>
              <FileText size={16} aria-hidden="true" />
              Notes{listLoaded && <span>{page.total}</span>}
            </h1>
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
            <h2>Your notes, close to your work.</h2>
            <p>
              Capture an idea, write a meeting note, or connect a thought to a
              record.
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

    </div>
  );
}
