import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import AppButton from '@/components/app-button';
import { useEffect, useState, type SubmitEvent } from 'react';
import { Bot, Check, Copy } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { request } from '@/lib/model';
import { agentLabel, agentHandoffHint, errorMessage, type Provider } from '@/lib/agent';
import { useAppPreferences } from '@/components/app-settings';

type Schedule = {provider:string;cadence:string;timezone:string;taskId:string;reportedAt:string|null;version:number};
type Run = {id:string;summary:string;learning:string;createdAt:string;importedIds:string[]};
type AgentState = {schedule:Schedule;runs:Run[];database:string;connection:{mcpServers:{nextstep:{command:string;args:string[]}}}};
type Props = {onClose:() => void;onSetup:() => void};

export default function AgentConnection({onClose,onSetup}: Props) {
  const {backendUrl} = useAppPreferences();
  const localDesktop = Boolean(window.nextstepDesktop && !backendUrl);
  const [state,setState] = useState<AgentState|null>(null);
  const [draft,setDraft] = useState({provider:'',cadence:'',timezone:''});
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [discard,setDiscard] = useState(false);
  const [unlink,setUnlink] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [setupText,setSetupText] = useState('');
  const dirty = Boolean(state && (draft.provider !== state.schedule.provider || draft.cadence !== state.schedule.cadence || draft.timezone !== (state.schedule.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone)));
  function accept(value:AgentState) { setState(value); setSetupText(''); setDraft({provider:value.schedule.provider,cadence:value.schedule.cadence,timezone:value.schedule.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone}); }
  useEffect(() => {
    let cancelled = false;
    request<AgentState>('/api/agent').then(value => { if (!cancelled) accept(value); }).catch(reason => { if (!cancelled) setError(reason.message); });
    return () => { cancelled = true; };
  },[attempt]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event:BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn);
  },[dirty]);
  const loaded = Boolean(state);
  useEffect(() => {
    if (!loaded || dirty || busy) return;
    let cancelled = false;
    const refresh = () => request<AgentState>('/api/agent').then(value => {
      if (cancelled) return;
      setState(value); setDraft({provider:value.schedule.provider,cadence:value.schedule.cadence,timezone:value.schedule.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone});
    }).catch(() => { /* Keep the last confirmed state; explicit actions show errors. */ });
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); },5000);
    return () => { cancelled = true; window.clearInterval(interval); };
  },[loaded,dirty,busy]);
  function close() { if (!busy) { if (dirty) setDiscard(true); else onClose(); } }
  async function save(event:SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (!state || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { accept(await request<AgentState>('/api/agent/schedule','PATCH',{...draft,version:state.schedule.version})); setNotice('Setup choices saved. Connect your agent and give it the setup request below.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save setup choices.'); }
    finally { setBusy(false); }
  }
  async function copy(value:string) {
    try { await navigator.clipboard.writeText(value); setNotice('Copied to clipboard.'); }
    catch { setError('Clipboard access was blocked. Select and copy the text below.'); }
  }
  async function copySetup() {
    setError('');
    try { const result = await request<{instructions:string}>('/api/agent/setup'); setSetupText(result.instructions); await copy(result.instructions); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not prepare the setup request.'); }
  }
  async function findMatches() {
    if (!state?.schedule.provider || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{instructions:string}>('/api/agent/search'); setSetupText(result.instructions);
      if (window.nextstepDesktop && localDesktop) {
        const opened = await window.nextstepDesktop.openAgent(state.schedule.provider as Provider,'search');
        setSetupText(opened.instructions);
        setNotice(agentHandoffHint(state.schedule.provider));
      } else {
        await navigator.clipboard.writeText(result.instructions);
        setNotice('Request copied. Paste into a new local Code/Codex conversation and send to start a search.');
      }
    } catch (reason) { setError(`${errorMessage(reason)} You can select the request below and open your agent yourself.`); }
    finally { setBusy(false); }
  }
  async function forget() {
    if (!state) return;
    setBusy(true); setError('');
    try { accept(await request<AgentState>('/api/agent/schedule','DELETE',{version:state.schedule.version})); setUnlink(false); setNotice('Registration removed from Nextstep.'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not unlink the task.'); }
    finally { setBusy(false); }
  }
  const connection = state?.connection.mcpServers.nextstep;
  const config = connection ? draft.provider === 'codex'
    ? `[mcp_servers.nextstep]\ncommand = ${JSON.stringify(connection.command)}\nargs = ${JSON.stringify(connection.args)}`
    : JSON.stringify(state?.connection,null,2) : '';
  return <><Sheet open onOpenChange={open => { if (!open) close(); }}><SheetContent className="opportunity-sheet agent-sheet">
    <SheetHeader className="editor-header"><div className="editor-eyebrow">RESEARCH THAT ADAPTS</div><div className="editor-heading"><span className="editor-icon"><Bot size={21}/></span><SheetTitle>Search agent</SheetTitle></div><SheetDescription>Your agent finds jobs using your preferences and learns from Interested and Uninterested choices.</SheetDescription></SheetHeader>
    <div className="editor-form"><div className="editor-scroll">
      {!state ? <output>{error ? 'Could not load agent setup.' : 'Loading agent setup…'}</output> : <>
        <AppButton className="primary-button" disabled={busy || dirty || !state.schedule.provider} onClick={() => { void findMatches(); }}><Bot size={15}/>{localDesktop ? `Find matches with ${agentLabel(state.schedule.provider)}` : 'Copy search request'}</AppButton><p className="agent-hint">{localDesktop ? 'Opens a new local conversation with your search request ready to send.' : 'Paste into a new local Code/Codex conversation and send.'} Your current preferences and board guide every search.</p><AppButton className="secondary-button" disabled={busy || dirty} onClick={onSetup}>Guided setup</AppButton>
        {setupText && <Collapsible defaultOpen><CollapsibleTrigger>Agent request</CollapsibleTrigger><CollapsibleContent><Textarea className="agent-setup-text" aria-label="Agent request" readOnly value={setupText} rows={8}/></CollapsibleContent></Collapsible>}<Collapsible className="agent-advanced"><CollapsibleTrigger>Advanced settings</CollapsibleTrigger><CollapsibleContent><form onSubmit={save} aria-label="Agent setup"><fieldset disabled={busy}>
          <div className="field"><Label htmlFor="agent-provider">Choose your desktop agent</Label><NativeSelect id="agent-provider" required value={draft.provider} onChange={event => setDraft({...draft,provider:event.target.value})}><NativeSelectOption value="">Choose an agent</NativeSelectOption><NativeSelectOption value="codex">Codex desktop</NativeSelectOption><NativeSelectOption value="claude-code">Claude Code Desktop</NativeSelectOption></NativeSelect><p className="agent-hint">Use a local desktop task so it can reach your SQLite database.</p></div>
          <div className="field"><Label htmlFor="agent-cadence">When should it search?</Label><Input id="agent-cadence" maxLength={300} value={draft.cadence} placeholder="Leave blank for on-demand searches" onChange={event => setDraft({...draft,cadence:event.target.value})}/></div>
          <div className="field"><Label htmlFor="agent-timezone">Timezone</Label><Input id="agent-timezone" required maxLength={100} value={draft.timezone} onChange={event => setDraft({...draft,timezone:event.target.value})}/></div>
          <AppButton type="submit" className="primary-button" disabled={busy}><Check size={16}/>{busy ? 'Saving…' : 'Save setup choices'}</AppButton>
        </fieldset></form>
        <div className="agent-section"><h3>Connect once, then schedule</h3><p>Add the local MCP connection in your agent, then give it the setup request. The agent asks for missing job preferences and creates the scheduled task in its own app.</p>
          <div className="agent-buttons"><AppButton className="secondary-button" disabled={!draft.provider || dirty || busy} onClick={() => { void copy(config); }}><Copy size={15}/>Copy connection settings</AppButton><AppButton className="secondary-button" disabled={!state.schedule.provider || dirty || busy} onClick={() => { void copySetup(); }}><Copy size={15}/>Copy setup request</AppButton></div>
          <Collapsible><CollapsibleTrigger>Connection settings</CollapsibleTrigger><CollapsibleContent><p>{draft.provider === 'codex' ? 'Add this server to Codex MCP settings or merge it into ~/.codex/config.toml.' : 'Merge this entry into the local MCP configuration for Claude Code Desktop. Preserve your other servers.'}</p><pre className="agent-config">{config}</pre></CollapsibleContent></Collapsible>
          {setupText && <Collapsible defaultOpen><CollapsibleTrigger>Setup request</CollapsibleTrigger><CollapsibleContent><Textarea className="agent-setup-text" aria-label="Setup request" readOnly value={setupText} rows={10}/></CollapsibleContent></Collapsible>}
          <p className="agent-hint">Keep your computer awake and the agent app running for local searches. The helper can read the database even when the Nextstep window is closed. Agent processing uses your chosen provider.</p>
        </div>
        </CollapsibleContent></Collapsible><div className="agent-section"><h3>Search schedule</h3><p>{state.schedule.reportedAt ? `Your agent reported a scheduled task: ${state.schedule.taskId}` : state.schedule.taskId ? 'Setup choices changed. Ask your agent to update the existing task.' : 'No scheduled task has been reported yet.'}</p><p className="agent-hint">Nextstep records the task ID supplied by your agent. Manage its actual status, pause, or resume in the agent app.</p>{state.schedule.taskId && <AppButton className="secondary-button" disabled={busy} onClick={() => setUnlink(true)}>Unlink a stopped task</AppButton>}</div>
        <div className="agent-section"><h3>Recent searches</h3>{state.runs.length ? state.runs.map(run => <article className="search-run" key={run.id}><div className="search-run-meta">{new Date(run.createdAt).toLocaleString()} · {run.importedIds.length} saved</div><p>{run.summary}</p>{run.learning && <p className="search-learning"><strong>Search adjustment</strong><br/>{run.learning}</p>}</article>) : <p>Completed searches will appear here with new matches and any adjustments based on your choices.</p>}</div>
      </>}
    </div><div className="editor-footer">{error && <div className="form-error" role="alert">{error}</div>}{notice && <output className="agent-notice">{notice}</output>}<div className="editor-actions">{!state && error && <AppButton className="secondary-button" onClick={() => { setError(''); setAttempt(value => value+1); }}>Retry loading</AppButton>}<AppButton className="secondary-button cancel-button" disabled={busy} onClick={close}>Close</AppButton></div></div></div>
  </SheetContent></Sheet>
  <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard setup changes?</AlertDialogTitle><AlertDialogDescription>Your agent setup choices haven’t been saved.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  <AlertDialog open={unlink} onOpenChange={setUnlink}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Unlink a stopped task?</AlertDialogTitle><AlertDialogDescription>Pause or delete the task in your agent first. Unlinking only removes its registration from Nextstep and does not stop scheduled searches.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { void forget(); }}>I stopped it, unlink</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
