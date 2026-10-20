import AppButton, { AppLink } from '@/components/app-button';
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  Activity,
  ArrowRight,
  Bot,
  ChevronRight,
  Database,
  Folder,
  Inbox,
  Layers2,
  LayoutGrid,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings,
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
import { FlowCard } from '@/components/crm/agent-flows';
import AgentPage from '@/components/crm/agent-page';
import { BoardSkeleton } from '@/components/board-controls';
import './workspace.css';
const currentRoute = () =>
  window.location.pathname === '/jobs' ? 'legacy-board' : window.location.hash.replace(/^#\/?/, '').split('?')[0] || 'overview';
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
            <AppButton tooltip="View change details" key={event.id} onClick={() => setSelected(event)}>
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
            </AppButton>
          ))}
        </div>
      )}
      {events.length === limit && limit < 200 && (
        <AppButton
          className="crm-button"
          onClick={() => setLimit(Math.min(200, limit + 50))}
        >
          Show more
        </AppButton>
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
            <AppButton className="crm-button" onClick={() => setSelected(null)}>
              Close
            </AppButton>
          </footer>
        </Modal>
      )}
    </>
  );
}
export default function WorkspaceApp() {
  const { backendUrl, openSettings, updateAvailable, sidebarCollapsed, setSidebarCollapsed } = useAppPreferences();
  const [desktopNavigation, setDesktopNavigation] = useState(() => window.nextstepDesktop?.platform === 'darwin' || matchMedia('(min-width: 801px)').matches);
  const collapsed = desktopNavigation && sidebarCollapsed;
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
    const media = matchMedia('(min-width: 801px)');
    const update = () => setDesktopNavigation(window.nextstepDesktop?.platform === 'darwin' || media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    const handler = () => {
      setRoute(currentRoute());
      setNavOpen(false);
      void refresh();
    };
    window.addEventListener('hashchange', handler);
    window.addEventListener('popstate', handler);
    window.addEventListener('nextstep:policy', handler);
    return () => { window.removeEventListener('hashchange', handler); window.removeEventListener('popstate', handler); window.removeEventListener('nextstep:policy', handler); };
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
    window.history.pushState(null, '', `/#/${path}`);
    setRoute(currentRoute());
    setNavOpen(false);
  };
  const activeCollectionId = route === 'legacy-board' ? workspace?.compatibilityCollectionId : route.startsWith('collections/') ? route.slice('collections/'.length) : null;
  const collection = workspace?.collections.find(c => c.id === activeCollectionId);
  const label =
    collection?.name ||
    {
      overview: 'Workspace home',
      review: 'Review changes',
      activity: 'History',
      agents: 'Agent',
      flows: 'Agent',
    }[route] ||
    'Workspace';
  useEffect(() => { document.title = `${label} · Nextstep`; }, [label]);
  async function changed() {
    await refresh();
  }
  function followLink(event: MouseEvent<HTMLAnchorElement>) {
      const link = event.currentTarget;
      if (!link || link.target || link.hasAttribute('download') || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      const url = new URL(link.href);
      if (url.origin !== location.origin || !['/', '/jobs'].includes(url.pathname) || (url.pathname === '/' && url.hash && !url.hash.startsWith('#/'))) return;
      // Preserve the shell, loaded styles and native window while navigating.
      // A modal draft must be closed explicitly before its route can disappear.
      if (document.querySelector('dialog[open]')) { event.preventDefault(); return; }
      event.preventDefault();
      history.pushState(null, '', url.pathname + url.hash);
      setRoute(currentRoute());
      setNavOpen(false);
      void refresh();
  }
  return (
    <div className={`crm-shell${collapsed ? ' is-sidebar-collapsed' : ''}`}>
      <AppLink href="#workspace-content" className="crm-skip">
        Skip to content
      </AppLink>
      <aside id="workspace-sidebar" className={`crm-sidebar ${navOpen ? 'is-open' : ''}`}>
        <div className="crm-sidebar-brand-row">
        <AppLink onClick={followLink} className="crm-brand" href="/#/overview" aria-label="Nextstep home">
          <img src={nextstepIcon} alt="" width={30} height={30} />
          <span>nextstep<span className="crm-brand-dot">.</span></span>
        </AppLink>
        {desktopNavigation && <AppButton
          className="crm-icon-button crm-sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-expanded={!collapsed}
          aria-controls="workspace-sidebar"
          onClick={() => void setSidebarCollapsed(!sidebarCollapsed).catch(e => setError(errorMessage(e)))}
        >{collapsed ? <PanelLeftOpen size={17}/> : <PanelLeftClose size={17}/>}</AppButton>}
        <AppButton aria-label="Close navigation" className="crm-icon-button crm-mobile-only crm-sidebar-close" onClick={() => setNavOpen(false)}><X size={17}/></AppButton>
        </div>
        <nav aria-label="Workspace navigation">
          {[
            { id: 'overview', label: 'Home', icon: LayoutGrid },
            { id: 'agents', label: 'Agent', icon: Bot },
            { id: 'review', label: 'Review changes', icon: Inbox },
            { id: 'activity', label: 'History', icon: Activity },
          ].filter(item => item.id !== 'review' || workspace?.policy.reviewRequired || Boolean(workspace?.pendingCount)).map((item) => (
            <AppLink
              key={item.id}
              onClick={followLink}
              href={`/#/${item.id}`}
              aria-label={item.label}
              aria-current={route === item.id || (item.id === 'agents' && route === 'flows') ? 'page' : undefined}
            >
              <item.icon size={17} aria-hidden="true" />
              <span className="crm-nav-label">{item.label}</span>
              {item.id === 'review' && Boolean(workspace?.pendingCount) && (
                <span className="crm-nav-count">{workspace?.pendingCount}</span>
              )}
            </AppLink>
          ))}
        </nav>
        {Boolean(workspace?.collections.length) && <>
          <div className="crm-sidebar-caption"><span>COLLECTIONS</span></div>
          <nav aria-label="Collections">{workspace?.collections.map(c => <AppLink onClick={followLink} key={c.id} href={`/#/collections/${c.id}`} aria-label={c.name} aria-current={collection?.id === c.id ? 'page' : undefined}><span className="crm-collection-dot" aria-hidden="true" style={{background:collapsed ? `${c.color}18` : c.color,color:c.color}}><span>{c.name.trim().split(/\s+/).map(word => word[0]).slice(0,2).join('').toUpperCase()}</span></span><span className="crm-nav-label">{c.name}</span><small aria-hidden="true">{c.recordCount}</small></AppLink>)}</nav>
        </>}
        <div className="crm-sidebar-bottom">
          <AppButton aria-label="Settings" title={updateAvailable ? 'Settings · update available' : 'Settings'} className="crm-settings-button" onClick={openSettings}>
            <Settings size={17} /><span className="crm-nav-label">Settings</span>{updateAvailable && <span className="settings-update-dot" aria-label="Update available"/>}
          </AppButton>

        </div>
      </aside>
      {navOpen && (
        <AppButton
          className="crm-nav-scrim"
          aria-label="Close navigation overlay"
          onClick={() => setNavOpen(false)}
        />
      )}
      <div className={`crm-main${collection ? ' crm-collection-main' : ''}`}>
        <header className="crm-topbar">
          <AppButton
            className="crm-icon-button crm-mobile-only"
            aria-label="Open navigation"
            onClick={() => setNavOpen(true)}
          >
            <Menu size={20} />
          </AppButton>
          <AppLink className="crm-home-link" href="/#/overview" onClick={followLink} aria-current={route === 'overview' ? 'page' : undefined}>
            <LayoutGrid size={14} aria-hidden="true"/>Workspace home
          </AppLink>
          {route !== 'overview' && <><ChevronRight size={13} aria-hidden="true"/>{collection ? <h1 className="crm-current-location" title={collection.description || collection.name}>{label}</h1> : <strong className="crm-current-location" aria-current="page">{label}</strong>}</>}
          <div>
            <span className="crm-topbar-local">
              <span />
              {backendUrl ? 'Self-hosted' : 'Local'}
            </span>
            <AppButton
              className="crm-icon-button"
              aria-label="Refresh workspace"
              onClick={() => void refresh()}
            >
              <RefreshCw size={15} />
            </AppButton>
          </div>
        </header>
        <main id="workspace-content" className={`crm-content${collection ? ' crm-collection-content' : ''}`}>
          {error && (
            <div className="crm-error" role="alert">
              {error}
              <AppButton
                className="crm-text-button"
                onClick={() => void refresh()}
              >
                Retry connection
              </AppButton>
            </div>
          )}
          {!workspace ? (
            error ? <div className="crm-empty"><Database size={28}/><h1>Workspace unavailable</h1></div> : <BoardSkeleton table/>

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
          ) : route === 'agents' || route === 'flows' ? (
            <AgentPage
              workspace={workspace}
              revision={revision}
              onWorkbench={() => setWorkbench({})}
              onNewCollection={() => setSchema({})}
              onReview={() => navigate('review')}
            />
          ) : !workspace.collections.length ? (
            <AgentTools workspace={workspace} onWorkbench={() => setWorkbench({})} onNewCollection={() => setSchema({})} onReview={() => navigate('review')}/>
          ) : (
            <>
              <div className="crm-page-heading crm-home-heading"><div><h1>Your workspace</h1><p>Your agent organizes the information. You keep the overview.</p></div><AppButton className="crm-button" onClick={() => navigate('agents')}><Bot size={16}/>Agent</AppButton></div>
              {workspace.pendingCount > 0 && <AppButton tooltip="Review proposed changes" className="crm-review-banner" onClick={() => navigate('review')}><Inbox size={20}/><span><strong>{workspace.pendingCount} {workspace.pendingCount === 1 ? 'change is' : 'changes are'} ready for review</strong><small>See what your agent wants to add or update.</small></span><ArrowRight size={18}/></AppButton>}
              <section className="crm-overview-section">
                <div className="crm-collection-cards">
                  {workspace.collections.map(c => (
                    <AppButton key={c.id} aria-label={`Open ${c.name}`} onClick={() => navigate(`collections/${c.id}`)}>
                      <div className="crm-collection-card-heading">
                        <span className="crm-collection-card-icon" aria-hidden="true" style={{background:`${c.color}18`,color:c.color}}><Folder size={19}/></span>
                        <h2>{c.name}</h2>
                      </div>
                      {c.description && <p>{c.description}</p>}
                      <small>
                        <span>{c.recordCount} {c.recordCount === 1 ? 'record' : 'records'} · {c.fields.length} {c.fields.length === 1 ? 'field' : 'fields'}</span>
                        <ArrowRight size={15} aria-hidden="true"/>
                      </small>
                    </AppButton>
                  ))}
                </div>
              </section>
              {workspace.recentFlows.length > 0 && <section className="crm-overview-section"><div className="crm-section-label"><h2>Agent progress</h2><AppButton className="crm-text-button" onClick={() => navigate('agents')}>View all<ArrowRight size={14}/></AppButton></div><div className="crm-flow-list">{workspace.recentFlows.slice(0,3).map(flow => <FlowCard key={flow.id} flow={flow} onClick={() => navigate('agents')}/>)}</div></section>}
              <details className="crm-home-tools"><summary>Manual tools</summary><div className="crm-manual-actions"><AppButton className="crm-button" onClick={() => setSchema({})}>Create a collection</AppButton><AppButton className="crm-button" onClick={() => setWorkbench({})}>Open JSON workbench</AppButton></div></details>
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
