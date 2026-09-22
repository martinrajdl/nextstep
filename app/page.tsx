'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ArrowUpRight, Bot, CalendarDays, Columns3, Eye, EyeOff, List, Plus, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { Toaster, toast } from 'sonner';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import JobBoard from '@/components/job-board';
import JobList from '@/components/job-list';
import OpportunityEditor from '@/components/opportunity-editor';
import SearchPreferences from '@/components/search-preferences';
import AgentConnection from '@/components/agent-connection';
import OnboardingWizard from '@/components/onboarding-wizard';
import type { AgentState } from '@/lib/agent';
import nextstepLogo from '@/desktop/icons/nextstep.png';
import { blankDraft, request, stageInfo, STAGES, today, type Draft, type Opportunity, type StageId } from '@/lib/model';

type Result = { opportunities: Opportunity[]; opportunity?: Opportunity };
type Editor = { job: Opportunity | null; stage: StageId } | null;
type WebTool = { name: string; title: string; description: string; inputSchema: object; annotations: { readOnlyHint: boolean; untrustedContentHint: boolean }; execute: (input: unknown) => unknown };
declare global { interface Document { modelContext?: { registerTool: (tool: WebTool, options?: { signal?: AbortSignal }) => void | Promise<void> } } }
function message(error: unknown) { return error instanceof Error ? error.message : 'Could not reach the local app. Try again.'; }

export default function Home() {
  const [jobs, setJobs] = useState<Opportunity[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const jobsRef = useRef(jobs);
  useEffect(() => { jobsRef.current = jobs; }, [jobs]);
  const [view, setView] = useState(() => { try { return localStorage.getItem('nextstep-view') === 'list' ? 'list' : 'board'; } catch { return 'board'; } });
  const [showUninterested, setShowUninterested] = useState(() => { try { return localStorage.getItem('nextstep-show-uninterested') !== 'false'; } catch { return true; } });
  const [scope, setScope] = useState('active');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('manual');
  const [editor, setEditor] = useState<Editor>(null);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false);
  const [agentState, setAgentState] = useState<AgentState|null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const refreshVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try { const data = await request<Result>('/api/opportunities'); if (version === refreshVersion.current) { setJobs(data.opportunities); setLoadError(''); } }
    catch (error) { if (version === refreshVersion.current) setLoadError(message(error)); }
    finally { if (version === refreshVersion.current) setLoading(false); }
  }, []);
  useEffect(() => { void Promise.resolve().then(refresh); }, [refresh]);
  useEffect(() => {
    const focus = () => { if (!busyRef.current && !editor && !preferencesOpen && !agentOpen && !setupOpen && document.visibilityState === 'visible') void refresh(); };
    const interval = window.setInterval(focus,15000);
    window.addEventListener('focus', focus); return () => { window.clearInterval(interval); window.removeEventListener('focus',focus); };
  }, [editor,preferencesOpen,agentOpen,setupOpen,refresh]);
  useEffect(() => {
    let cancelled = false;
    request<AgentState>('/api/agent').then(value => {
      if (cancelled) return;
      setAgentState(value);
      if (value.onboarding.status === 'new') setSetupOpen(true);
    }).catch(() => { /* Setup has its own retry UI. */ });
    return () => { cancelled = true; };
  },[]);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || editor || preferencesOpen || agentOpen || setupOpen || loading || loadError) return;
      const target = event.target as HTMLElement;
      if (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable || target.closest('[role="dialog"]')) return;
      if (event.key === '/') { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setEditor({job:null,stage:'prospect'}); }
    }
    window.addEventListener('keydown',key); return () => window.removeEventListener('keydown',key);
  }, [editor,preferencesOpen,agentOpen,setupOpen,loading,loadError]);
  const mutate = useCallback(async (path: string, method: string, data: unknown) => {
    if (busyRef.current) throw new Error('Wait for the previous change to finish saving.');
    busyRef.current = true; setBusy(true); ++refreshVersion.current;
    try { const result = await request<Result>(path,method,data); setJobs(result.opportunities); jobsRef.current = result.opportunities; setLoadError(''); return result; }
    finally { busyRef.current = false; setBusy(false); }
  }, []);
  const save = useCallback(async (draft: Draft, existing: Opportunity | null) => {
    try {
      const result = await mutate(existing ? `/api/opportunities/${existing.id}` : '/api/opportunities',existing ? 'PATCH' : 'POST',existing ? {...draft,version:existing.version} : draft);
      setScope(stageInfo(draft.stage).closed ? 'closed' : 'active'); setQuery(''); setFilter('all');
      toast.success(existing ? 'Opportunity updated' : `${draft.company.trim()} added to your pipeline`);
      return result.opportunity!;
    } catch (error) {
      // Keep the editor draft, but refresh the board so reopening a conflict uses the latest version.
      void refresh();
      throw error;
    }
  }, [mutate,refresh]);
  const move = useCallback(async (job: Opportunity, stage: StageId, beforeId: string | null) => {
    if (busyRef.current) return;
    const previous = jobsRef.current;
    const target = previous.filter(item => item.stage === stage && item.id !== job.id);
    const index = beforeId ? target.findIndex(item => item.id === beforeId) : target.length;
    target.splice(index < 0 ? target.length : index,0,{...job,stage});
    setJobs([...previous.filter(item => item.stage !== stage && item.id !== job.id),...target.map((item,position) => ({...item,position}))].sort((a,b) => a.position-b.position));
    try { const result = await mutate(`/api/opportunities/${job.id}/move`,'POST',{stage,beforeId,version:job.version}); toast.success(job.stage === stage ? 'Order saved' : `${job.company} moved to ${stageInfo(stage).name}`); return result.opportunity; }
    catch (error) { setJobs(previous); toast.error(message(error)); void refresh(); throw error; }
  }, [mutate,refresh]);
  const moveFromUI = (job: Opportunity, stage: StageId, beforeId: string | null) => { void move(job,stage,beforeId).catch(() => {}); };
  async function remove(job: Opportunity) {
    await mutate(`/api/opportunities/${job.id}`,'DELETE',{version:job.version});
    toast('Opportunity removed',{duration:12000,action:{label:'Undo',onClick: () => { void mutate(`/api/opportunities/${job.id}/restore`,'POST',{}).then(() => toast.success('Opportunity restored')).catch(error => toast.error(message(error))); }}});
  }
  useEffect(() => {
    const context = document.modelContext; if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const tools: WebTool[] = [
      {name:'list_opportunities',title:'List opportunities',description:'Read the opportunities currently saved in this local job CRM.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:() => ({opportunities:jobsRef.current})},
      {name:'create_opportunity',title:'Create opportunity',description:'Save a new company or job prospect and display it in the pipeline.',inputSchema:{type:'object',properties:{company:{type:'string',minLength:1,maxLength:160},role:{type:'string'},url:{type:'string'},notes:{type:'string'},stage:{type:'string',enum:STAGES.map(stage => stage.id)}},required:['company'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input => { const value = input as Partial<Draft>; if (!value || typeof value !== 'object' || typeof value.company !== 'string' || !value.company.trim()) throw new Error('A company name is required.'); const job = await save({...blankDraft(),...value},null); return {id:job.id,company:job.company,stage:job.stage}; }},
      {name:'move_opportunity',title:'Move opportunity',description:'Move an existing opportunity to an interview stage and save its position. Omit beforeId to place it last.',inputSchema:{type:'object',properties:{id:{type:'string'},stage:{type:'string',enum:STAGES.map(stage => stage.id)},beforeId:{type:['string','null']}},required:['id','stage'],additionalProperties:false},annotations:{readOnlyHint:false,untrustedContentHint:true},execute:async input => { const value = input as {id:string;stage:StageId;beforeId?:string|null}; if (!value || !STAGES.some(stage => stage.id === value.stage)) throw new Error('A valid stage is required.'); const job = jobsRef.current.find(job => job.id === value.id); if (!job) throw new Error('Opportunity not found.'); const result = await move(job,value.stage,value.beforeId || null); if (!result) throw new Error('A save is already in progress.'); return {id:result.id,stage:result.stage}; }},
    ];
    for (const tool of tools) { try { void Promise.resolve(context.registerTool(tool,{signal:lifecycle.signal})).catch(error => console.warn('Optional CRM tool registration failed',error)); } catch (error) { console.warn('Optional CRM tool registration failed',error); } }
    return () => lifecycle.abort();
  }, [save,move]);
  const active = jobs.filter(job => !stageInfo(job.stage).closed && job.stage !== 'uninterested');
  const closed = jobs.filter(job => stageInfo(job.stage).closed);
  const dueCount = active.filter(job => job.followUp && job.followUp <= today()).length;
  const stages = STAGES.filter(stage => stage.closed === (scope === 'closed') && (showUninterested || stage.id !== 'uninterested'));
  const needle = query.trim().toLowerCase();
  const filtered = Boolean(needle || filter !== 'all');
  let visible = jobs.filter(job => stageInfo(job.stage).closed === (scope === 'closed') && (view === 'list' || showUninterested || job.stage !== 'uninterested') && (!needle || [job.company,job.role,job.location,job.contact,job.contactEmail,job.notes,job.nextStep].some(value => value.toLowerCase().includes(needle))) && (filter !== 'high' || job.priority === 'high') && (filter !== 'due' || Boolean(job.followUp && job.followUp <= today())));
  if (view === 'list') visible = [...visible].sort((a,b) => sort === 'company' ? a.company.localeCompare(b.company) : sort === 'due' ? (a.followUp || '9999').localeCompare(b.followUp || '9999') : sort === 'newest' ? b.createdAt.localeCompare(a.createdAt) : STAGES.findIndex(stage => stage.id === a.stage)-STAGES.findIndex(stage => stage.id === b.stage) || a.position-b.position);
  const add = (stage: StageId = 'prospect') => setEditor({job:null,stage});
  function changeView(value: unknown) { const next = String(value); setView(next); try { localStorage.setItem('nextstep-view',next); } catch { /* Preferences are optional. */ } }
  function toggleUninterested() {
    const next = !showUninterested;
    setShowUninterested(next);
    try { localStorage.setItem('nextstep-show-uninterested',String(next)); } catch { /* Preferences are optional. */ }
  }
  function openAgent() { if (agentState?.onboarding.connectedAt || agentState?.schedule.taskId) setAgentOpen(true); else setSetupOpen(true); }
  return <div className="app-shell">
    <Toaster richColors position="bottom-right" closeButton style={{ zIndex: 40 }}/>
    <header className="app-header">
      <a className="brand" href="/" aria-label="Nextstep home"><img className="brand-logo" src={nextstepLogo} alt="" width={40} height={40}/>nextstep</a>
      <div className="header-right">
        <output className={`local-badge ${loadError ? 'offline' : ''}`} title={loading ? 'Connecting…' : loadError ? 'Connection interrupted' : busy ? 'Saving…' : 'Saved locally'}><span className="local-dot" aria-hidden="true"/><span className="local-status-label">{loading ? 'Connecting…' : loadError ? 'Connection interrupted' : busy ? 'Saving…' : 'Saved locally'}</span></output>
        <button className="preferences-button agent-button" onClick={openAgent} aria-label="Search agent" title={agentState && !agentState.onboarding.connectedAt ? 'Set up or continue connecting your search agent' : 'Search agent'}><Bot size={16}/><span>Search agent</span>{agentState && !agentState.onboarding.connectedAt && <i className="setup-indicator" aria-label="Setup available"/>}</button>
        <button className="preferences-button" onClick={() => setPreferencesOpen(true)} aria-label="Search preferences" title="Search preferences"><SlidersHorizontal size={16}/><span>Preferences</span></button>
        <button className="primary-button header-new" onClick={() => add()} disabled={loading || Boolean(loadError)} aria-label="New opportunity" title="New opportunity (N)"><Plus size={16}/><span className="new-label">New opportunity</span><span className="new-label-short" aria-hidden="true">New</span></button>
      </div>
    </header>
    <main>
      <h1 className="sr-only">Job pipeline</h1>
      <div className="toolbar">
        <Tabs value={view} onValueChange={changeView}><TabsList className="view-tabs"><TabsTrigger value="board"><Columns3 size={15}/>Board</TabsTrigger><TabsTrigger value="list"><List size={16}/>List</TabsTrigger></TabsList></Tabs>
        <div className="scope-switch" aria-label="Opportunity status"><button aria-pressed={scope==='active'} onClick={() => setScope('active')}>Active<span>{active.length}</span></button><button aria-pressed={scope==='closed'} onClick={() => setScope('closed')}>Closed<span>{closed.length}</span></button></div>
        {view === 'board' && scope === 'active' && <button className="column-visibility-button" onClick={toggleUninterested} aria-label={showUninterested ? 'Hide uninterested' : 'Show uninterested'} title={showUninterested ? 'Hide uninterested' : 'Show uninterested'}>{showUninterested ? <EyeOff size={15}/> : <Eye size={15}/>}<span>{showUninterested ? 'Hide uninterested' : 'Show uninterested'}</span></button>}
        {dueCount > 0 && <button className="due-filter-button" aria-label={`Show ${dueCount} follow-ups due`} aria-pressed={filter === 'due'} title={`${dueCount} follow-ups due`} onClick={() => { setScope('active'); setQuery(''); setFilter(filter === 'due' ? 'all' : 'due'); }}><CalendarDays size={14}/>{dueCount} due</button>}
        <div className="search-wrap"><Search size={15}/><input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)} placeholder="Search opportunities…" aria-label="Search opportunities"/>{query && <button className="clear-search" onClick={() => setQuery('')} aria-label="Clear search"><X size={13}/></button>}</div>
        <NativeSelect className="filter-select" aria-label="Filter opportunities" value={filter} onChange={e => setFilter(e.target.value)}><NativeSelectOption value="all">All priorities</NativeSelectOption><NativeSelectOption value="high">High priority</NativeSelectOption><NativeSelectOption value="due">Follow-ups due{dueCount > 0 ? ` (${dueCount})` : ''}</NativeSelectOption></NativeSelect>
        {view === 'list' && <NativeSelect className="sort-select" aria-label="Sort opportunities" value={sort} onChange={e => setSort(e.target.value)}><NativeSelectOption value="manual">Pipeline order</NativeSelectOption><NativeSelectOption value="company">Company A–Z</NativeSelectOption><NativeSelectOption value="due">Follow-up date</NativeSelectOption><NativeSelectOption value="newest">Newest first</NativeSelectOption></NativeSelect>}
        <a className="export-button" href="/api/export" download title="Export a JSON backup" aria-label="Export a JSON backup"><ArrowDownToLine size={16}/></a>
      </div>
      {loadError && <div className="connection-error" role="alert"><span>Couldn’t connect to your local database. Your saved opportunities are still on this device.</span><button className="secondary-button" onClick={() => { setLoading(true); void refresh(); }}><RefreshCw size={14}/>Retry</button></div>}
      {filtered && <div className="filter-notice"><span>{visible.length} matching {visible.length === 1 ? 'opportunity' : 'opportunities'}</span><button onClick={() => { setQuery('');setFilter('all'); }}>Clear filters <X size={12}/></button></div>}
      <div className={loading ? 'is-loading' : ''} aria-busy={loading}>
        {view === 'board' ? <JobBoard jobs={visible} allJobs={jobs} stages={stages} busy={busy || loading || Boolean(loadError)} filtered={filtered} onOpen={job => setEditor({job,stage:job.stage})} onAdd={stage => { if (!loading && !loadError) add(stage); }} onMove={moveFromUI}/> : <JobList jobs={visible} busy={busy || loading || Boolean(loadError)} filtered={filtered} onOpen={job => setEditor({job,stage:job.stage})} onMove={moveFromUI} onAdd={() => add()}/>}
      </div>
      <footer className="board-footer"><span><ArrowUpRight size={14}/>One opportunity at a time.</span><span>{view === 'board' ? 'Drag cards to change stages · N to add' : `${visible.length} ${visible.length === 1 ? 'opportunity' : 'opportunities'} · Click a company to edit`}</span></footer>
    </main>
    {editor && <OpportunityEditor key={editor.job?.id || `new-${editor.stage}`} opportunity={editor.job} stage={editor.stage} onClose={() => setEditor(null)} onSave={async (draft,existing) => { await save(draft,existing); }} onDelete={remove}/>}
    {preferencesOpen && <SearchPreferences onClose={() => setPreferencesOpen(false)} onSaved={() => toast.success('Search preferences saved')}/>}
    {agentOpen && <AgentConnection onClose={() => setAgentOpen(false)} onSetup={() => { setAgentOpen(false); setSetupOpen(true); }}/>}
    {setupOpen && <OnboardingWizard onClose={value => { setSetupOpen(false); if (value) setAgentState(value); void refresh(); }}/>}
  </div>;
}
