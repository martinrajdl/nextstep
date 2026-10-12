import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  FileJson,
  Folder,
  Inbox,
  Layers2,
  LayoutGrid,
  Menu,
  Plus,
  RefreshCw,
  Sparkles,
  Settings,
  GitBranch,
  X,
} from 'lucide-react';
import { request } from '@/lib/model';
import {
  dateTime,
  displayValue,
  errorMessage,
  type Collection,
  type Event,
  type RecordItem,
  type Template,
  type Workspace,
} from '@/lib/crm';
import SchemaEditor from '@/components/crm/schema-editor';
import RecordEditor from '@/components/crm/record-editor';
import CollectionView from '@/components/crm/collection-view';
import Review, { DiffView } from '@/components/crm/review';
import AgentTools, { ChangeWorkbench } from '@/components/crm/agent-tools';
import Modal from '@/components/crm/modal';
import nextstepIcon from '@/desktop/icons/nextstep-ui.png';
import { useAppPreferences } from '@/components/app-settings';
import AgentFlows, {
  FlowCard,
  FlowLifecycle,
} from '@/components/crm/agent-flows';
import './workspace.css';
const currentRoute = () =>
  window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
function ActivityView({ revision }: { revision: number }) {
  const [events, setEvents] = useState<Event[]>([]),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<Event | null>(null),
    [limit, setLimit] = useState(50);
  useEffect(() => {
    let cancelled = false;
    request<{ events: Event[] }>(`/api/crm/history?limit=${limit}`)
      .then((data) => {
        if (!cancelled) {
          setEvents(data.events);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [revision, limit]);
  return (
    <>
      <div className="crm-page-heading">
        <div className="crm-eyebrow">A SHARED MEMORY</div>
        <h1>Workspace activity</h1>
        <p>
          Every applied change, its author, and the values before and after.
        </p>
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {!events.length ? (
        <div className="crm-empty">
          <Activity size={32} />
          <h2>Your history starts here.</h2>
          <p>Changes from you and your agents appear in the same timeline.</p>
        </div>
      ) : (
        <div className="crm-activity-list">
          {events.map((event) => (
            <button key={event.id} onClick={() => setSelected(event)}>
              <span className="crm-activity-icon">
                {event.actor === 'You' ? (
                  <Layers2 size={16} />
                ) : (
                  <Bot size={16} />
                )}
              </span>
              <span>
                <strong>
                  {displayValue(
                    event.after?.title ||
                      event.after?.name ||
                      event.before?.title ||
                      event.before?.name ||
                      event.entityId,
                  )}
                </strong>
                <small>
                  {event.actor} · {event.action.replaceAll('_', ' ')}
                </small>
              </span>
              <time>{dateTime(event.createdAt)}</time>
              <ChevronRight size={15} />
            </button>
          ))}
        </div>
      )}
      {events.length === limit && limit < 200 && (
        <button
          className="crm-button"
          onClick={() => setLimit(Math.min(200, limit + 50))}
        >
          Show more
        </button>
      )}
      <p className="crm-hint">
        Showing the latest {events.length} events. The workspace export includes
        the complete history.
      </p>
      {selected && (
        <Modal
          wide
          title="Change details"
          subtitle={`${selected.actor} · ${dateTime(selected.createdAt)}`}
          onClose={() => setSelected(null)}
        >
          <div className="crm-form-body">
            <DiffView diff={selected} />
            <p className="crm-hint">Change ID: {selected.changeId}</p>
          </div>
          <footer>
            <button className="crm-button" onClick={() => setSelected(null)}>
              Close
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
export default function WorkspaceApp() {
  const { backendUrl, openSettings } = useAppPreferences();
  const [workspace, setWorkspace] = useState<Workspace | null>(null),
    [error, setError] = useState(''),
    [route, setRoute] = useState(currentRoute),
    [revision, setRevision] = useState(0),
    [navOpen, setNavOpen] = useState(false);
  const [schema, setSchema] = useState<{
      collection?: Collection;
      template?: Template;
    } | null>(null),
    [recordEditor, setRecordEditor] = useState<{
      collection: Collection;
      record: RecordItem | null;
    } | null>(null),
    [workbench, setWorkbench] = useState<{ collection?: Collection } | null>(
      null,
    );
  const refresh = useCallback(async () => {
    try {
      const data = await request<Workspace>('/api/crm/context');
      setWorkspace(data);
      setError('');
      setRevision((v) => v + 1);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);
  useEffect(() => {
    const handler = () => {
      setRoute(currentRoute());
      setNavOpen(false);
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, []);
  useEffect(() => {
    const refreshVisible = () => {
      if (
        document.visibilityState === 'visible' &&
        !schema &&
        !recordEditor &&
        !workbench
      )
        void refresh();
    };
    const timer = window.setInterval(refreshVisible, 20000);
    window.addEventListener('focus', refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
    };
  }, [refresh, schema, recordEditor, workbench]);
  const navigate = (path: string) => {
    window.location.hash = `/${path}`;
    setNavOpen(false);
  };
  const collection = workspace?.collections.find(
    (c) => route === `collections/${c.id}`,
  );
  const label =
    collection?.name ||
    {
      overview: 'Workspace',
      review: 'Review inbox',
      activity: 'Activity',
      agents: 'Agent connection',
      flows: 'Agent flows',
    }[route] ||
    'Workspace';
  async function changed() {
    await refresh();
  }
  return (
    <div className="crm-shell">
      <a href="#workspace-content" className="crm-skip">
        Skip to content
      </a>
      <aside className={`crm-sidebar ${navOpen ? 'is-open' : ''}`}>
        <a className="crm-brand" href="#/overview">
          <img src={nextstepIcon} alt="" width={42} height={42} />
          nextstep<span className="crm-brand-dot">.</span>
        </a>
        <div className="crm-workspace-label">
          <span className="crm-workspace-icon">N</span>
          <span>
            Your workspace
            <small>
              Private · {backendUrl ? 'self-hosted' : 'local database'}
            </small>
          </span>
          <button
            aria-label="Close navigation"
            className="crm-icon-button crm-mobile-only"
            onClick={() => setNavOpen(false)}
          >
            <X size={17} />
          </button>
        </div>
        <nav aria-label="Workspace navigation">
          {[
            { id: 'overview', label: 'Overview', icon: LayoutGrid },
            { id: 'flows', label: 'Agent flows', icon: GitBranch },
            { id: 'review', label: 'Review inbox', icon: Inbox },
            { id: 'activity', label: 'Activity', icon: Activity },
            { id: 'agents', label: 'Agent connection', icon: Bot },
          ].map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <item.icon size={17} />
              {item.label}
              {item.id === 'review' && Boolean(workspace?.pendingCount) && (
                <span className="crm-nav-count">{workspace?.pendingCount}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="crm-sidebar-caption">
          COLLECTIONS
          <button
            aria-label="New collection"
            className="crm-icon-button"
            onClick={() => setSchema({})}
            disabled={!workspace}
          >
            <Plus size={15} />
          </button>
        </div>
        <nav aria-label="Collections">
          {workspace?.collections.map((c) => (
            <a
              key={c.id}
              href={`#/collections/${c.id}`}
              aria-current={collection?.id === c.id ? 'page' : undefined}
            >
              <span
                className="crm-collection-dot"
                style={{ background: c.color }}
              />
              {c.name}
              <small>{c.recordCount}</small>
            </a>
          ))}
          {!workspace?.collections.length && (
            <span className="crm-sidebar-empty">Room for your next idea.</span>
          )}
        </nav>
        <div className="crm-sidebar-caption">WORKSPACES</div>
        <nav>
          <a href="/jobs">
            <BriefcaseBusiness size={17} />
            Job search
            <ArrowUpRight size={13} />
          </a>
        </nav>
        <div className="crm-sidebar-bottom">
          <button className="crm-settings-button" onClick={openSettings}>
            <Settings size={17} /> Settings
          </button>
          <div className="crm-local-state">
            <span />
            <div>
              On your terms.<small>Stored in your SQLite database.</small>
            </div>
            <Database size={15} />
          </div>
          <a
            href="https://github.com/martinrajdl/nextstep"
            target="_blank"
            rel="noreferrer"
          >
            Open source, by design <ArrowUpRight size={12} />
          </a>
        </div>
      </aside>
      {navOpen && (
        <button
          className="crm-nav-scrim"
          aria-label="Close navigation overlay"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className="crm-main">
        <header className="crm-topbar">
          <button
            className="crm-icon-button crm-mobile-only"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </button>
          <span>Workspace</span>
          <ChevronRight size={13} />
          <strong>{label}</strong>
          <div>
            <span className="crm-topbar-local">
              <span />
              {backendUrl ? 'Self-hosted' : 'Local'}
            </span>
            <button
              className="crm-icon-button"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
            </button>
            <a
              className="crm-icon-button"
              href="/api/crm/export"
              download
              aria-label="Export workspace"
              title="Export collections, records, proposals and history"
            >
              <ArrowDownToLine size={16} />
            </a>
          </div>
        </header>
        <main id="workspace-content" className="crm-content">
          {error && (
            <div className="crm-error" role="alert">
              {error}
              <button
                className="crm-text-button"
                onClick={() => void refresh()}
              >
                Retry connection
              </button>
            </div>
          )}
          {!workspace ? (
            <div className="crm-empty">
              <Database size={28} />
              <h1>
                {error ? 'Workspace unavailable' : 'Opening your workspace…'}
              </h1>
            </div>
          ) : collection ? (
            <CollectionView
              key={collection.id}
              collection={collection}
              revision={revision}
              onNew={() => setRecordEditor({ collection, record: null })}
              onOpen={(record) => setRecordEditor({ collection, record })}
              onSchema={() => setSchema({ collection })}
              onImport={() => setWorkbench({ collection })}
              onChanged={changed}
            />
          ) : route === 'review' ? (
            <Review onChanged={changed} revision={revision} />
          ) : route === 'activity' ? (
            <ActivityView revision={revision} />
          ) : route === 'agents' ? (
            <AgentTools
              workspace={workspace}
              onWorkbench={() => setWorkbench({})}
            />
          ) : route === 'flows' ? (
            <AgentFlows
              revision={revision}
              onConnect={() => navigate('agents')}
            />
          ) : (
            <>
              <section className="crm-overview-hero">
                <div>
                  <div className="crm-eyebrow">
                    <span />
                    YOUR AGENTS. YOUR DIRECTION.
                  </div>
                  <h1>
                    Make room for
                    <br />
                    what’s next<span>.</span>
                  </h1>
                  <p>
                    Agents source contacts, shape your workspace, and move the
                    work forward.
                    <br />
                    Follow their progress. Review what matters.
                  </p>
                  <div className="crm-hero-actions">
                    <button
                      className="crm-button crm-button-primary"
                      onClick={() => navigate('agents')}
                    >
                      <Bot size={16} />
                      Give your agent a brief
                    </button>
                    <button
                      className="crm-button crm-button-subtle"
                      onClick={() => setSchema({})}
                    >
                      Create a collection
                      <Plus size={16} />
                    </button>
                  </div>
                </div>
                <div className="crm-overview-art" aria-hidden="true">
                  <div className="crm-art-orbit" />
                  <div className="crm-art-node art-one">
                    <Folder size={20} />
                    Context
                  </div>
                  <div className="crm-art-node art-two">
                    <Bot size={20} />
                    Agents
                  </div>
                  <div className="crm-art-node art-three">
                    <Sparkles size={18} />
                    Possibility
                  </div>
                  <div className="crm-art-center">
                    <img src={nextstepIcon} alt="" width={94} height={94} />
                  </div>
                  <span className="crm-art-label">
                    A SYSTEM THAT TAKES YOUR SHAPE
                  </span>
                </div>
              </section>
              <FlowLifecycle />
              <section className="crm-overview-section">
                <div className="crm-section-label">
                  <div>
                    <h2>Work in motion</h2>
                    <p>
                      Your agent’s progress, from finding information to keeping
                      it useful.
                    </p>
                  </div>
                  <button
                    className="crm-text-button"
                    onClick={() => navigate('flows')}
                  >
                    All agent flows <ArrowRight size={14} />
                  </button>
                </div>
                {workspace.recentFlows.length ? (
                  <div className="crm-flow-list">
                    {workspace.recentFlows.slice(0, 3).map((flow) => (
                      <FlowCard
                        key={flow.id}
                        flow={flow}
                        onClick={() => navigate('flows')}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="crm-flow-start">
                    <Bot size={24} />
                    <div>
                      <strong>
                        You set the direction. Your agent takes it from there.
                      </strong>
                      <p>
                        Describe the people, information, or process you want to
                        manage. Your agent builds the structure and reports its
                        progress here.
                      </p>
                    </div>
                    <button
                      className="crm-button crm-button-primary"
                      onClick={() => navigate('agents')}
                    >
                      Give your agent a brief <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </section>
              <div className="crm-stats">
                <div>
                  <span>Collections</span>
                  <strong>
                    {workspace.collections.length.toString().padStart(2, '0')}
                  </strong>
                  <small>Structures you define</small>
                </div>
                <div>
                  <span>Records</span>
                  <strong>
                    {workspace.recordCount.toString().padStart(2, '0')}
                  </strong>
                  <small>Pieces of useful context</small>
                </div>
                <button onClick={() => navigate('review')}>
                  <span>
                    Ready for review <ArrowUpRight size={15} />
                  </span>
                  <strong>
                    {workspace.pendingCount.toString().padStart(2, '0')}
                  </strong>
                  <small>
                    {workspace.pendingCount
                      ? 'Your agents have something for you'
                      : 'A clear inbox, a clear head'}
                  </small>
                </button>
              </div>
              {workspace.collections.length > 0 && (
                <section className="crm-overview-section">
                  <div className="crm-section-label">
                    <h2>Your collections</h2>
                    <button
                      className="crm-text-button"
                      onClick={() => setSchema({})}
                    >
                      <Plus size={14} />
                      New collection
                    </button>
                  </div>
                  <div className="crm-collection-cards">
                    {workspace.collections.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => navigate(`collections/${c.id}`)}
                      >
                        <span
                          style={{ background: `${c.color}18`, color: c.color }}
                        >
                          <Folder size={21} />
                        </span>
                        <h3>{c.name}</h3>
                        <p>
                          {c.description || 'Your information, your structure.'}
                        </p>
                        <small>
                          {c.recordCount} records · {c.fields.length} fields
                          <ArrowRight size={15} />
                        </small>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="crm-overview-section">
                <div className="crm-section-label">
                  <div>
                    <h2>Start with a little structure.</h2>
                    <p>Pick a starting point. Make it entirely yours.</p>
                  </div>
                  <span className="crm-mini-label">EMPTY BY DESIGN</span>
                </div>
                <div className="crm-template-grid">
                  {workspace.templates.map((template) => (
                    <button
                      key={template.id}
                      disabled={workspace.collections.some(
                        (c) => c.id === template.id,
                      )}
                      onClick={() => setSchema({ template })}
                    >
                      <span
                        className="crm-template-icon"
                        style={{ color: template.color }}
                      >
                        <Folder size={23} />
                      </span>
                      <h3>{template.name}</h3>
                      <p>{template.description}</p>
                      <span className="crm-template-cta">
                        {workspace.collections.some((c) => c.id === template.id)
                          ? 'Added to workspace'
                          : 'Use template'}
                        <Plus size={14} />
                      </span>
                    </button>
                  ))}
                </div>
              </section>
              <section className="crm-agent-banner">
                <span className="crm-banner-icon">
                  <Bot size={26} />
                </span>
                <div>
                  <h2>Give your agent a place to work.</h2>
                  <p>
                    Read context, propose a structure, enrich records. You
                    review what happens next.
                  </p>
                </div>
                <button
                  className="crm-button"
                  onClick={() => navigate('agents')}
                >
                  Connect an agent
                  <ArrowRight size={15} />
                </button>
              </section>
              <div className="crm-overview-footer">
                <span>Local first. Open source. Yours to shape.</span>
                <button
                  className="crm-text-button"
                  onClick={() => setWorkbench({})}
                >
                  <FileJson size={14} />
                  JSON workbench
                </button>
              </div>
            </>
          )}
        </main>
      </div>
      {schema && workspace && (
        <SchemaEditor
          workspace={workspace}
          collection={schema.collection}
          template={schema.template}
          onClose={() => setSchema(null)}
          onSaved={async (id) => {
            setSchema(null);
            await refresh();
            navigate(`collections/${id}`);
          }}
        />
      )}
      {recordEditor && (
        <RecordEditor
          collection={recordEditor.collection}
          record={recordEditor.record}
          onClose={() => setRecordEditor(null)}
          onSaved={async () => {
            setRecordEditor(null);
            await refresh();
          }}
        />
      )}
      {workbench && (
        <ChangeWorkbench
          collection={workbench.collection}
          onClose={() => setWorkbench(null)}
          onSaved={async () => {
            setWorkbench(null);
            await refresh();
            navigate('review');
          }}
        />
      )}
    </div>
  );
}
