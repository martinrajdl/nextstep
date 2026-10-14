import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bot,
  BriefcaseBusiness,
  ChevronRight,
  Database,
  Folder,
  Inbox,
  Layers2,
  LayoutGrid,
  Menu,
  RefreshCw,
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
        <div className="crm-eyebrow">YOUR WORKSPACE HISTORY</div>
        <h1>History</h1>
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
  const previousWorkspace = useRef<Workspace | null>(null);
  const refresh = useCallback(async () => {
    try {
      const data = await request<Workspace>('/api/crm/context');
      const previous = previousWorkspace.current;
      previousWorkspace.current = data;
      setWorkspace(data);
      if (previous && !previous.collections.length && data.collections.length && ['overview','agents','review'].includes(currentRoute())) window.location.hash = `/collections/${data.collections[0].id}`;
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
      void refresh();
    };
    window.addEventListener('hashchange', handler);
    return () => window.removeEventListener('hashchange', handler);
  }, [refresh]);
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
    const timer = window.setInterval(refreshVisible, 4000);
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
      overview: 'Workspace home',
      review: 'Review changes',
      activity: 'History',
      agents: 'Connect an agent',
      flows: 'Agent progress',
    }[route] ||
    'Workspace';
  useEffect(() => { document.title = `${label} · Nextstep`; }, [label]);
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
            Main workspace
            <small>
              {backendUrl ? 'Your own server' : 'Saved on this computer'}
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
            { id: 'overview', label: 'Home', icon: LayoutGrid },
            { id: 'flows', label: 'Agent progress', icon: GitBranch },
            { id: 'review', label: 'Review changes', icon: Inbox },
            { id: 'activity', label: 'History', icon: Activity },
            { id: 'agents', label: 'Your agent', icon: Bot },
          ].filter(item => item.id === 'overview' || Boolean(workspace?.collections.length) || (item.id === 'review' && Boolean(workspace?.pendingCount)) || (item.id === 'flows' && Boolean(workspace?.recentFlows.length))).map((item) => (
            <a
              key={item.id}
              href={`#/${item.id}`}
              aria-label={item.label}
              aria-current={route === item.id ? 'page' : undefined}
            >
              <item.icon size={17} aria-hidden="true" />
              {item.label}
              {item.id === 'review' && Boolean(workspace?.pendingCount) && (
                <span className="crm-nav-count">{workspace?.pendingCount}</span>
              )}
            </a>
          ))}
        </nav>
        {Boolean(workspace?.collections.length) && <>
          <div className="crm-sidebar-caption">YOUR COLLECTIONS</div>
          <nav aria-label="Collections">{workspace?.collections.map(c => <a key={c.id} href={`#/collections/${c.id}`} aria-current={collection?.id === c.id ? 'page' : undefined}><span className="crm-collection-dot" style={{background:c.color}}/>{c.name}<small>{c.recordCount}</small></a>)}</nav>
        </>}
        <div className="crm-sidebar-caption">OTHER WORKSPACES</div>
        <nav>
          <a href="/jobs">
            <BriefcaseBusiness size={17} />
            Job search
            <ChevronRight size={13} aria-hidden="true" />
          </a>
        </nav>
        <div className="crm-sidebar-bottom">
          <button className="crm-settings-button" onClick={openSettings}>
            <Settings size={17} /> Settings
          </button>
          <div className="crm-local-state">
            <span />
            <div>
              {backendUrl ? 'Saved on your server' : 'Saved on this computer'}<small>You choose which agents have access.</small>
            </div>
            <Database size={15} />
          </div>
          <a
            href="https://github.com/martinrajdl/nextstep"
            target="_blank"
            rel="noreferrer"
          >
            View source on GitHub <ArrowUpRight size={12} />
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
          <a className="crm-home-link" href="#/overview" onClick={() => setNavOpen(false)} aria-current={route === 'overview' ? 'page' : undefined}>
            <LayoutGrid size={14} aria-hidden="true"/>Workspace home
          </a>
          {route !== 'overview' && <><ChevronRight size={13} aria-hidden="true"/><strong className="crm-current-location" aria-current="page">{label}</strong></>}
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
              onNewCollection={() => setSchema({})}
              onReview={() => navigate('review')}
            />
          ) : route === 'flows' ? (
            <AgentFlows
              revision={revision}
              onConnect={() => navigate('agents')}
            />
          ) : !workspace.collections.length ? (
            <AgentTools workspace={workspace} onWorkbench={() => setWorkbench({})} onNewCollection={() => setSchema({})} onReview={() => navigate('review')}/>
          ) : (
            <>
              <div className="crm-page-heading crm-home-heading"><div><h1>Your workspace</h1><p>Your agent organizes the information. You keep the overview.</p></div><button className="crm-button" onClick={() => navigate('agents')}><Bot size={16}/>Your agent</button></div>
              {workspace.pendingCount > 0 && <button className="crm-review-banner" onClick={() => navigate('review')}><Inbox size={20}/><span><strong>{workspace.pendingCount} {workspace.pendingCount === 1 ? 'change is' : 'changes are'} ready for review</strong><small>See what your agent wants to add or update.</small></span><ArrowRight size={18}/></button>}
              <section className="crm-overview-section">
                <div className="crm-collection-cards">{workspace.collections.map(c => <button key={c.id} onClick={() => navigate(`collections/${c.id}`)}><span style={{background:`${c.color}18`,color:c.color}}><Folder size={21}/></span><h2>{c.name}</h2><p>{c.description || `${c.fields.length} fields · ${c.recordCount} records`}</p><small>{c.recordCount} records<ArrowRight size={15}/></small></button>)}</div>
              </section>
              {workspace.recentFlows.length > 0 && <section className="crm-overview-section"><div className="crm-section-label"><h2>Agent progress</h2><button className="crm-text-button" onClick={() => navigate('flows')}>View all<ArrowRight size={14}/></button></div><div className="crm-flow-list">{workspace.recentFlows.slice(0,3).map(flow => <FlowCard key={flow.id} flow={flow} onClick={() => navigate('flows')}/>)}</div></section>}
              <details className="crm-home-tools"><summary>Manual tools</summary><div className="crm-manual-actions"><button className="crm-button" onClick={() => setSchema({})}>Create a collection</button><button className="crm-button" onClick={() => setWorkbench({})}>Open JSON workbench</button></div></details>
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
