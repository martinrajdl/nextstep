import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef, useState, type RefObject } from 'react';
import {
  Bold,
  Italic,
  Heading2,
  List,
  ListTodo,
  Code,
  Link2,
  History,
  Pin,
  Archive,
  Trash2,
  Download,
  Maximize2,
  Minimize2,
  Table2,
  MoreHorizontal,
  ListOrdered,
  Quote,
  Strikethrough,
  Minus,
  ImageIcon,
  ExternalLink,
} from 'lucide-react';
import AppButton from '@/components/app-button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  applyChange,
  dateTime,
  errorMessage,
  type Event,
  type RecordItem,
} from '@/lib/crm';
import { request } from '@/lib/model';
import type { Note } from '@/lib/notes';

const extensions = [
  StarterKit.configure({
    link: {
      openOnClick: false,
      protocols: ['http', 'https', 'mailto', 'nextstep'],
    },
  }),
  Markdown,
  Image.configure({
    HTMLAttributes: { loading: 'lazy', referrerpolicy: 'no-referrer' },
  }),
  TableKit,
  TaskList,
  TaskItem.configure({ nested: true }),
  Placeholder.configure({
    placeholder: 'Start writing. Use Markdown, add #tags, or link a record.',
  }),
];
// Keep extended syntax in its original source rather than letting a visual conversion discard it.
const requiresSource = (body: string) => {
  const prose = body
    .replace(/(`{3,}|~{3,})[^\n]*\n[\s\S]*?\1/g, '')
    .replace(/`+[^`]*`+/g, '');
  if (
    prose
      .split('\n')
      .some(
        (line) =>
          line.includes('![') && !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line),
      )
  )
    return true;
  return /<!--[\s\S]*?-->|<\/?[a-z][^>]*>|\[\^[^\]]+\]|^---\n[\s\S]*?\n---(?:\n|$)|!\[[^\]]*\]\((?:file:|data:|javascript:)/im.test(
    prose,
  );
};
type Draft = Pick<Note, 'title' | 'body' | 'pinned' | 'links' | 'state'>;
const draftOf = (n: Note): Draft => ({
  title: n.title,
  body: n.body,
  pinned: n.pinned,
  links: n.links,
  state: n.state,
});
export default function NoteEditor({
  note,
  onSaved,
  canLeave,
  onOpen,
  focus,
  onFocus,
}: {
  note: Note;
  onSaved: (note: Note) => void;
  canLeave: RefObject<() => Promise<boolean>>;
  onOpen: (id: string) => void;
  focus: boolean;
  onFocus: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(note));
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const base = useRef(note),
    saved = useRef(JSON.stringify(draftOf(note)));
  const [state, setState] = useState('Saved'),
    [error, setError] = useState(''),
    [source, setSource] = useState(() => requiresSource(note.body)),
    [history, setHistory] = useState<Event[] | null>(null),
    [incoming, setIncoming] = useState<Note | null>(null),
    [linkQuery, setLinkQuery] = useState(''),
    [targets, setTargets] = useState<RecordItem[] | null>(null);
  const [tick, setTick] = useState(0);
  const [insert, setInsert] = useState<'link' | 'image' | null>(null),
    [insertUrl, setInsertUrl] = useState(''),
    [insertLabel, setInsertLabel] = useState('');
  const composing = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null),
    insertInput = useRef<HTMLInputElement>(null);
  const newDocument = useRef(note.title === 'Untitled' && !note.body);
  useEffect(() => {
    if (newDocument.current) titleInput.current?.focus();
  }, []);
  useEffect(() => {
    if (insert) insertInput.current?.focus();
  }, [insert]);
  const sourceOnly = requiresSource(draft.body);
  const usingSource = source || sourceOnly;
  const busy = useRef<Promise<boolean> | null>(null),
    mounted = useRef(true);
  const changed = JSON.stringify(draft) !== saved.current;
  const blocked = useRef(false);
  blocked.current = changed || Boolean(busy.current);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const editor = useEditor({
    extensions,
    content: note.body,
    contentType: 'markdown',
    editorProps: {
      handleDOMEvents: {
        click: (_view, event) => {
          const link = (event.target as HTMLElement).closest('a');
          if (link?.getAttribute('href')?.startsWith('nextstep:')) {
            event.preventDefault();
            onOpen(link.getAttribute('href')!.slice(9));
            return true;
          }
          const href = link?.getAttribute('href');
          if (
            href &&
            /^(https?:|mailto:)/i.test(href) &&
            (event.metaKey || event.ctrlKey)
          ) {
            event.preventDefault();
            window.open(href, '_blank', 'noopener,noreferrer');
            return true;
          }
          return false;
        },
      },
      attributes: {
        class: 'notes-prose',
        role: 'textbox',
        'aria-label': 'Note body',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor }) => {
      setDraft((d) => ({ ...d, body: editor.getMarkdown() }));
      setError('');
    },
    shouldRerenderOnTransaction: false,
  });
  const syncEditor = (body: string) => {
    editor?.commands.setContent(body, {
      contentType: 'markdown',
      emitUpdate: false,
    });
  };
  async function flush(): Promise<boolean> {
    if (busy.current) {
      await busy.current;
      if (JSON.stringify(draftRef.current) !== saved.current) return flush();
      return true;
    }
    if (JSON.stringify(draftRef.current) === saved.current) return true;
    if (composing.current || editor?.view.composing) return false;
    if (incoming) return false;
    const sending = { ...draftRef.current },
      version = base.current.version;
    setState('Saving…');
    busy.current = (async () => {
      try {
        const change = await applyChange('Edit note', [
          { type: 'update_note', id: note.id, version, ...sending },
        ]);
        const updated = change.result[0].after as Note;
        base.current = updated;
        saved.current = JSON.stringify(sending);
        if (mounted.current) {
          setState('Saved');
          setError('');
          setTick((t) => t + 1);
          onSavedRef.current(updated);
        }
        return true;
      } catch (e) {
        if (mounted.current) {
          setState('Not saved');
          setError(errorMessage(e));
          try {
            const current = await request<Note>(`/api/notes/${note.id}`);
            if (current.version !== base.current.version) setIncoming(current);
          } catch {
            /* Keep the local buffer on connection loss. */
          }
        }
        return false;
      } finally {
        busy.current = null;
      }
    })();
    return busy.current;
  }
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    canLeave.current = () => flushRef.current();
    return () => {
      mounted.current = false;
      canLeave.current = async () => true;
    };
  }, [canLeave]);
  useEffect(() => {
    if (!changed || incoming || error) return;
    const timer = setTimeout(() => void flushRef.current(), 550);
    return () => clearTimeout(timer);
  }, [draft, changed, tick, incoming, error]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void flushRef.current();
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  useEffect(() => {
    const guard = (event: globalThis.Event) => {
      if (blocked.current) {
        event.preventDefault();
        if (event.type === 'beforeunload')
          Object.defineProperty(event, 'returnValue', {
            value: '',
            writable: true,
          });
        else setError('Please save or copy this note before leaving.');
      }
    };
    const previousUrl = location.pathname + location.hash;
    const backGuard = (event: globalThis.Event) => {
      if (blocked.current) {
        event.stopImmediatePropagation();
        window.history.pushState(null, '', previousUrl);
        setError('Please save or copy this note before leaving.');
      }
    };
    window.addEventListener('hashchange', backGuard, true);
    window.addEventListener('popstate', backGuard, true);
    window.addEventListener('beforeunload', guard as EventListener);
    window.addEventListener('nextstep:before-navigate', guard as EventListener);
    return () => {
      window.removeEventListener('hashchange', backGuard, true);
      window.removeEventListener('popstate', backGuard, true);
      window.removeEventListener('beforeunload', guard as EventListener);
      window.removeEventListener(
        'nextstep:before-navigate',
        guard as EventListener,
      );
    };
  }, []);
  useEffect(() => {
    if (note.version === base.current.version) return;
    if (blocked.current) {
      setIncoming(note);
      return;
    }
    base.current = note;
    saved.current = JSON.stringify(draftOf(note));
    setDraft(draftOf(note));
    editor?.commands.setContent(note.body, {
      contentType: 'markdown',
      emitUpdate: false,
    });
  }, [note, editor]);
  async function addLinkSearch(value: string) {
    setLinkQuery(value);
    const context = await request<{ collections: { id: string }[] }>(
      '/api/crm/context',
    );
    const pages = await Promise.all(
      context.collections.map((c) =>
        request<{ records: RecordItem[] }>('/api/crm/query', 'POST', {
          collectionId: c.id,
          search: value,
          limit: 10,
        }),
      ),
    );
    setTargets(
      pages
        .flatMap((p) => p.records)
        .filter((r) => r.id !== note.id)
        .slice(0, 30),
    );
  }
  const action = (title: string, run: () => void, Icon: typeof Bold) => (
    <AppButton
      key={title}
      className="crm-icon-button"
      aria-label={title}
      title={title}
      onClick={run}
    >
      <Icon size={16} />
    </AppButton>
  );
  const mutate = (values: Partial<Draft>) => {
    setDraft((d) => ({ ...d, ...values }));
    setError('');
  };
  const download = () => {
    const blob = new Blob([`# ${draft.title}\n\n${draft.body}`], {
        type: 'text/markdown',
      }),
      url = URL.createObjectURL(blob),
      a = document.createElement('a');
    a.href = url;
    a.download = `${draft.title.replace(/[^\p{L}\p{N} _-]/gu, '').slice(0, 80) || 'note'}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <article className="notes-document">
      <div className="notes-document-toolbar">
        <output className={state === 'Not saved' ? 'crm-error' : ''}>
          {changed && state === 'Saved' ? 'Unsaved' : state}
        </output>
        <div>
          <AppButton
            className="crm-text-button"
            disabled={sourceOnly}
            title={
              sourceOnly
                ? 'Extended Markdown stays in source mode'
                : 'Toggle Markdown source'
            }
            aria-pressed={usingSource}
            onClick={() => {
              setSource(!usingSource);
              if (usingSource && !sourceOnly) syncEditor(draft.body);
            }}
          >
            {usingSource ? 'Write' : 'Markdown'}
          </AppButton>
          {action(
            draft.pinned ? 'Unpin note' : 'Pin note',
            () => mutate({ pinned: !draft.pinned }),
            Pin,
          )}
          {action(
            focus ? 'Exit focus mode' : 'Focus mode',
            onFocus,
            focus ? Minimize2 : Maximize2,
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <AppButton
                  className="crm-icon-button"
                  aria-label="Note actions"
                  title="Note actions"
                >
                  <MoreHorizontal size={17} />
                </AppButton>
              }
            />
            <DropdownMenuContent align="end" className="crm-menu-popup">
              <DropdownMenuGroup>
                <DropdownMenuItem
                  onClick={() =>
                    void request<{ events: Event[] }>(
                      `/api/crm/history?entityId=${note.id}`,
                    )
                      .then((r) => setHistory(r.events))
                      .catch((e) => setError(errorMessage(e)))
                  }
                >
                  <History size={14} />
                  Note history
                </DropdownMenuItem>
                <DropdownMenuItem onClick={download}>
                  <Download size={14} />
                  Export Markdown
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    mutate({
                      state: draft.state === 'archived' ? 'active' : 'archived',
                    })
                  }
                >
                  <Archive size={14} />
                  {draft.state === 'archived'
                    ? 'Unarchive note'
                    : 'Archive note'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    mutate({
                      state: draft.state === 'trash' ? 'active' : 'trash',
                    })
                  }
                >
                  <Trash2 size={14} />
                  {draft.state === 'trash'
                    ? 'Restore note'
                    : 'Move note to trash'}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {incoming && (
        <div className="notes-conflict" role="alert">
          <strong>
            This note changed elsewhere. Your writing is preserved.
          </strong>
          <p>
            Compare your text below with the incoming version. Save both to keep
            your work as a separate note.
          </p>
          <details>
            <summary>Incoming version</summary>
            <pre>
              {incoming.title}
              {'\n\n'}
              {incoming.body}
            </pre>
          </details>
          <AppButton
            className="crm-button"
            onClick={() =>
              void applyChange('Preserve conflicting note', [
                {
                  type: 'create_note',
                  ...draft,
                  title: `${draft.title.slice(0, 175)} (conflict copy)`,
                },
              ])
                .then(() => {
                  base.current = incoming;
                  saved.current = JSON.stringify(draftOf(incoming));
                  setDraft(draftOf(incoming));
                  syncEditor(incoming.body);
                  setIncoming(null);
                  setError('');
                  setState('Saved');
                  onSaved(incoming);
                })
                .catch((e) => setError(errorMessage(e)))
            }
          >
            Save both
          </AppButton>
        </div>
      )}
      {error && (
        <div className="crm-error" role="alert">
          {error}
          <AppButton
            className="crm-text-button"
            onClick={() => {
              setError('');
              void flushRef.current();
            }}
          >
            Retry save
          </AppButton>
          <AppButton
            className="crm-text-button"
            onClick={() =>
              void navigator.clipboard.writeText(
                `${draft.title}\n\n${draft.body}`,
              )
            }
          >
            Copy my text
          </AppButton>
        </div>
      )}
      <div className="notes-paper">
        <Input
          ref={titleInput}
          className="notes-title"
          aria-label="Note title"
          placeholder="Untitled"
          value={draft.title === 'Untitled' ? '' : draft.title}
          maxLength={200}
          onChange={(e) => mutate({ title: e.target.value })}
        />
        <div className="notes-meta">
          {dateTime(note.updatedAt)}
          {note.conflictOf && <span> · Recovered conflict copy</span>}
          {draft.state !== 'active' && (
            <span> · {draft.state === 'trash' ? 'In trash' : 'Archived'}</span>
          )}
        </div>
        {!usingSource && (
          <div className="notes-formatting" aria-label="Formatting">
            {action(
              'Bold',
              () => editor?.chain().focus().toggleBold().run(),
              Bold,
            )}
            {action(
              'Italic',
              () => editor?.chain().focus().toggleItalic().run(),
              Italic,
            )}
            {action(
              'Heading',
              () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
              Heading2,
            )}
            {action(
              'Bullet list',
              () => editor?.chain().focus().toggleBulletList().run(),
              List,
            )}
            {action(
              'Checklist',
              () => editor?.chain().focus().toggleTaskList().run(),
              ListTodo,
            )}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <AppButton
                    className="crm-icon-button"
                    aria-label="More formatting"
                    title="More formatting"
                  >
                    <MoreHorizontal size={16} />
                  </AppButton>
                }
              />
              <DropdownMenuContent className="crm-menu-popup">
                <DropdownMenuGroup>
                  {[1, 2, 3, 4, 5, 6].map((level) => (
                    <DropdownMenuItem
                      key={level}
                      onClick={() =>
                        editor
                          ?.chain()
                          .focus()
                          .toggleHeading({
                            level: level as 1 | 2 | 3 | 4 | 5 | 6,
                          })
                          .run()
                      }
                    >
                      <Heading2 size={14} />
                      Heading {level}
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuItem
                    onClick={() =>
                      editor?.chain().focus().toggleOrderedList().run()
                    }
                  >
                    <ListOrdered size={14} />
                    Numbered list
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      editor?.chain().focus().toggleBlockquote().run()
                    }
                  >
                    <Quote size={14} />
                    Quote
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => editor?.chain().focus().toggleStrike().run()}
                  >
                    <Strikethrough size={14} />
                    Strikethrough
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      editor?.chain().focus().toggleCodeBlock().run()
                    }
                  >
                    <Code size={14} />
                    Code block
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      editor?.chain().focus().setHorizontalRule().run()
                    }
                  >
                    <Minus size={14} />
                    Divider
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      editor
                        ?.chain()
                        .focus()
                        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                        .run()
                    }
                  >
                    <Table2 size={14} />
                    Insert table
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setInsert('link');
                      setInsertUrl('');
                      setInsertLabel('');
                    }}
                  >
                    <ExternalLink size={14} />
                    Web link
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setInsert('image');
                      setInsertUrl('');
                      setInsertLabel('');
                    }}
                  >
                    <ImageIcon size={14} />
                    Image URL
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            {action(
              'Link a note or record',
              () =>
                void addLinkSearch('').catch((e) => setError(errorMessage(e))),
              Link2,
            )}
          </div>
        )}
        {sourceOnly && (
          <p className="crm-hint notes-source-hint">
            This note uses extended Markdown. Edit its source to preserve every
            detail.
          </p>
        )}
        {insert && (
          <form
            className="notes-insert"
            onSubmit={(event) => {
              event.preventDefault();
              if (!/^https?:\/\//i.test(insertUrl)) {
                setError('Use an http or https URL.');
                return;
              }
              if (insert === 'image')
                editor
                  ?.chain()
                  .focus()
                  .setImage({ src: insertUrl, alt: insertLabel })
                  .run();
              else
                editor
                  ?.chain()
                  .focus()
                  .insertContent({
                    type: 'text',
                    text: insertLabel || insertUrl,
                    marks: [{ type: 'link', attrs: { href: insertUrl } }],
                  })
                  .run();
              setInsert(null);
            }}
          >
            <Input
              ref={insertInput}
              aria-label={insert === 'image' ? 'Image URL' : 'Link URL'}
              placeholder="https://example.com"
              value={insertUrl}
              onChange={(e) => setInsertUrl(e.target.value)}
              required
              type="url"
            />
            <Input
              aria-label={
                insert === 'image' ? 'Image description' : 'Link text'
              }
              placeholder={
                insert === 'image' ? 'Image description' : 'Link text'
              }
              value={insertLabel}
              onChange={(e) => setInsertLabel(e.target.value)}
            />
            <AppButton type="submit" className="crm-button">
              Insert
            </AppButton>
            <AppButton type="button" onClick={() => setInsert(null)}>
              Cancel
            </AppButton>
          </form>
        )}
        {usingSource ? (
          <Textarea
            className="notes-source"
            aria-label="Markdown source"
            value={draft.body}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              setTick((t) => t + 1);
            }}
            onChange={(e) => mutate({ body: e.target.value })}
          />
        ) : (
          <EditorContent editor={editor} />
        )}
        <div className="notes-linked-records">
          {draft.links.map((id) => (
            <AppButton
              className="crm-text-button"
              key={id}
              onClick={() => onOpen(id)}
            >
              <Link2 size={13} />
              Linked record · {id.slice(0, 8)}
            </AppButton>
          ))}
        </div>
        {targets && (
          <section className="notes-link-picker" aria-label="Link picker">
            <Input
              aria-label="Find note or record"
              placeholder="Find a note or record…"
              value={linkQuery}
              onChange={(e) =>
                void addLinkSearch(e.target.value).catch((e) =>
                  setError(errorMessage(e)),
                )
              }
            />
            {targets.map((r) => (
              <AppButton
                key={r.id}
                onClick={() => {
                  mutate({ links: [...new Set([...draft.links, r.id])] });
                  if (usingSource)
                    mutate({
                      body:
                        draft.body +
                        `\n[${r.title.replace(/[[\]]/g, '')}](nextstep:${r.id})`,
                    });
                  else
                    editor
                      ?.chain()
                      .focus()
                      .insertContent({
                        type: 'text',
                        text: r.title,
                        marks: [
                          { type: 'link', attrs: { href: `nextstep:${r.id}` } },
                        ],
                      })
                      .run();
                  setTargets(null);
                }}
              >
                {r.title}
                <small>{r.collectionId}</small>
              </AppButton>
            ))}
            <AppButton
              className="crm-text-button"
              onClick={() => setTargets(null)}
            >
              Close
            </AppButton>
          </section>
        )}
        {history && (
          <section className="notes-history">
            <div>
              <h2>Document history</h2>
              <AppButton
                className="crm-text-button"
                onClick={() => setHistory(null)}
              >
                Close
              </AppButton>
            </div>
            {history
              .filter((e) => typeof e.after?.body === 'string')
              .map((event) => (
                <details key={event.id}>
                  <summary>
                    {event.actor} · {dateTime(event.createdAt)}
                  </summary>
                  <pre>{String(event.after?.body)}</pre>
                  <AppButton
                    className="crm-button"
                    onClick={() => {
                      mutate({ body: String(event.after?.body) });
                      syncEditor(String(event.after?.body));
                      setHistory(null);
                    }}
                  >
                    Restore this text
                  </AppButton>
                </details>
              ))}
          </section>
        )}
      </div>
    </article>
  );
}
