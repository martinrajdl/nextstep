import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, CheckCheck, Copy, ExternalLink, LoaderCircle, LockKeyhole, Plug, Sparkles, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { profileDraft, profileFields, type SearchProfile, type SearchProfileDraft } from '@/lib/search-profile';
import { agentLabel, agentHandoffHint, connectionText, errorMessage, type AgentState, type DesktopAgent, type Provider } from '@/lib/agent';
import { request } from '@/lib/model';
import nextstepLogo from '@/desktop/icons/nextstep.png';

type Props = {onClose:(state?:AgentState) => void;initialStep?:number};
const stepNames = ['Your search','Your agent','Ready to go'];

export default function OnboardingWizard({onClose,initialStep}:Props) {
  const [state,setState] = useState<AgentState|null>(null);
  const [profile,setProfile] = useState<SearchProfile|null>(null);
  const [draft,setDraft] = useState<SearchProfileDraft|null>(null);
  const [step,setStep] = useState(0);
  const [provider,setProvider] = useState<Provider|''>('');
  const [cadence,setCadence] = useState('');
  const [frequency,setFrequency] = useState('demand');
  const [time,setTime] = useState('09:00');
  const [timezone,setTimezone] = useState(new Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [apps,setApps] = useState<DesktopAgent[]>([]);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [discard,setDiscard] = useState(false);
  const [attempt,setAttempt] = useState(0);
  const [setupText,setSetupText] = useState('');
  const [requestReady,setRequestReady] = useState(false);
  const [manualReady,setManualReady] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const effectiveCadence = frequency === 'demand' ? '' : frequency === 'custom' ? cadence : `${frequency === 'weekdays' ? 'Weekdays' : 'Every day'} at ${time}`;
  const dirty = Boolean(state && profile && draft && (JSON.stringify(profileDraft(profile)) !== JSON.stringify(draft) || provider !== state.schedule.provider || effectiveCadence !== state.schedule.cadence || timezone !== (state.schedule.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone)));

  useEffect(() => {
    let cancelled = false;
    Promise.all([request<AgentState>('/api/agent'),request<{profile:SearchProfile}>('/api/profile')]).then(([agent,result]) => {
      if (cancelled) return;
      setState(agent); setProfile(result.profile); setDraft(profileDraft(result.profile));
      setProvider(agent.schedule.provider); setCadence(agent.schedule.cadence); setFrequency(agent.schedule.cadence ? 'custom' : 'demand');
      setTimezone(agent.schedule.timezone || new Intl.DateTimeFormat().resolvedOptions().timeZone);
      setStep(initialStep ?? (agent.onboarding.status === 'complete' && agent.onboarding.connectedAt ? 0 : agent.onboarding.step)); setError('');
    }).catch(reason => { if (!cancelled) setError(errorMessage(reason)); });
    window.nextstepDesktop?.getAgents().then(value => { if (!cancelled) setApps(value); }).catch(() => { /* Manual setup remains available. */ });
    return () => { cancelled = true; };
  },[attempt,initialStep]);
  const loaded = Boolean(state);
  useEffect(() => { if (loaded) heading.current?.focus(); },[step,loaded]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event:BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload',warn); return () => window.removeEventListener('beforeunload',warn);
  },[dirty]);
  useEffect(() => {
    if (step !== 2 || busy) return;
    let cancelled = false;
    const refresh = () => request<AgentState>('/api/agent').then(value => { if (!cancelled) setState(current => !current || value.onboarding.version >= current.onboarding.version ? value : current); }).catch(() => { if (!cancelled) setNotice('Waiting for the local app. You can keep the setup request and try again.'); });
    const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); },2500);
    window.addEventListener('focus',refresh);
    return () => { cancelled = true; window.clearInterval(interval); window.removeEventListener('focus',refresh); };
  },[step,busy]);

  async function saveProgress(nextStep:number,status:AgentState['onboarding']['status']='started',current=state) {
    if (!current) throw new Error('Setup has not finished loading. Try again.');
    const value = await request<AgentState>('/api/onboarding','PATCH',{version:current.onboarding.version,step:nextStep,status});
    setState(value); return value;
  }
  async function next(event:SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !state || !profile || !draft) return;
    setBusy(true); setError(''); setNotice('');
    try {
      let current = state;
      if (step === 0) {
        if (!draft.roles.trim()) throw new Error('Tell your agent what kind of work you want. A short description is enough.');
        if (JSON.stringify(profileDraft(profile)) !== JSON.stringify(draft)) {
          const saved = await request<{profile:SearchProfile}>('/api/profile','PATCH',{...draft,version:profile.version});
          setProfile(saved.profile); setDraft(profileDraft(saved.profile));
        }
      } else {
        if (!provider) throw new Error('Choose an agent to continue.');
        if (frequency !== 'demand' && !effectiveCadence.trim()) throw new Error('Choose when your agent should search.');
        if (provider !== state.schedule.provider || effectiveCadence !== state.schedule.cadence || timezone !== state.schedule.timezone) {
          current = await request<AgentState>('/api/agent/schedule','PATCH',{provider,cadence:effectiveCadence,timezone,version:state.schedule.version});
          setState(current);
        }
      }
      await saveProgress(step+1,'started',current); setStep(step+1); setSetupText(''); setRequestReady(false); setManualReady(false);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  async function finish(status:'dismissed'|'complete') {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // Connection reports can arrive while the wizard is open. Re-read before closing.
      const latest = await request<AgentState>('/api/agent');
      const saved = await saveProgress(step,status,latest); onClose(saved);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  function close() { if (!busy) { if (!state) onClose(); else if (dirty) setDiscard(true); else void finish('dismissed'); } }
  async function copySetup(openAgent=false) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await request<{instructions:string}>('/api/agent/setup'); setSetupText(result.instructions);
      if (openAgent && provider && window.nextstepDesktop) {
        const opened = await window.nextstepDesktop.openAgent(provider,'setup');
        setSetupText(opened.instructions);
        setState(await request<AgentState>('/api/agent'));
        setNotice(agentHandoffHint(provider));
      } else {
        await navigator.clipboard.writeText(result.instructions);
        setNotice(`Copied. Paste into a new local ${provider === 'claude-code' ? 'conversation in Claude Desktop’s Code tab' : 'Codex task'} and send it.`);
      }
      setRequestReady(true);
    } catch (reason) { setError(`Could not finish the handoff. ${errorMessage(reason)} You can copy the request below and open your agent yourself.`); }
    finally { setBusy(false); }
  }
  const configured = Boolean(state?.onboarding.configuredAt && state.onboarding.configuredProvider === provider);
  const confirmed = Boolean(state?.onboarding.connectedAt && state.onboarding.connectedProvider === provider);
  const selectedApp = apps.find(app => app.provider === provider);
  const label = agentLabel(provider);

  return <><Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="setup-wizard" showCloseButton={false}>
    <aside className="setup-aside"><div className="setup-brand"><img src={nextstepLogo} alt="" width={44} height={44}/>nextstep</div><div className="setup-aside-copy"><span className="setup-eyebrow">A LITTLE SETUP. A CLEARER SEARCH.</span><h2>Your next chapter<br/>starts here.</h2><p>One place for the opportunities<br className="setup-desktop-break"/> that could become your next job.</p></div><ol className="setup-steps" aria-label="Setup progress">{stepNames.map((name,index) => <li key={name} aria-current={step === index ? 'step' : undefined} className={index < step ? 'done' : ''}><span>{index < step ? <Check size={14}/> : index+1}</span>{name}</li>)}</ol><div className="setup-private"><LockKeyhole size={15}/><span>Your board stays on this device.<br/>You choose which agent can use it.</span></div></aside>
    <div className="setup-main"><button className="setup-close" aria-label="Close setup" disabled={busy} onClick={close}><X size={19}/></button>
      <form className="setup-form" onSubmit={next}>
        <div className="setup-scroll">
          <div className="setup-step-label">STEP {step+1} OF 3 <span>{stepNames[step]}</span></div>
          <DialogTitle ref={heading} tabIndex={-1} className="setup-title">{step === 0 ? 'What would you love to do next?' : step === 1 ? 'A little help finding your next role.' : confirmed ? 'Your agent found its way here.' : 'One connection. Then you’re off.'}</DialogTitle>
          <DialogDescription className="setup-description">{step === 0 ? 'Start with the essentials. Your agent can help fill in the details later.' : step === 1 ? 'Choose the desktop agent you already use. It will find jobs and bring the best matches back here.' : 'Connect once, then give your agent a short setup request. Your board will update as it finds matches.'}</DialogDescription>
          {!state || !draft ? <output className="setup-loading">{error ? 'Setup could not load.' : 'Loading your saved preferences…'}</output> : <fieldset disabled={busy}>
            {step === 0 && <>
              {profileFields.slice(0,3).map(({key,label:fieldLabel,maxLength}) => <div className="field" key={key}><label htmlFor={`setup-${key}`}>{key === 'roles' ? 'What kind of work are you looking for?' : key === 'locations' ? 'Where can you work?' : 'How do you like to work?'}{key !== 'roles' && <span className="setup-optional">Optional</span>}</label><textarea id={`setup-${key}`} maxLength={maxLength} rows={key === 'roles' ? 3 : 2} value={draft[key]} placeholder={key === 'roles' ? 'Describe the roles, responsibilities, or level you want…' : key === 'locations' ? 'Location, work eligibility, or timezone…' : 'Remote, on site, a mix, or open to anything…'} aria-label={fieldLabel} onChange={event => setDraft({...draft,[key]:event.target.value})}/></div>)}
              <details className="setup-details"><summary>Add more about your search <span>Optional</span></summary><div>{profileFields.slice(3).map(({key,label:fieldLabel,hint,maxLength}) => <div className="field" key={key}><label htmlFor={`setup-${key}`}>{fieldLabel}</label><textarea id={`setup-${key}`} value={draft[key]} rows={2} maxLength={maxLength} placeholder={hint} onChange={event => setDraft({...draft,[key]:event.target.value})}/></div>)}</div></details>
            </>}
            {step === 1 && <>
              <fieldset className="setup-agent-options" aria-label="Choose your desktop agent">{(['codex','claude-code'] as const).map(id => <button type="button" key={id} className={`setup-agent-option ${provider === id ? 'selected' : ''}`} aria-pressed={provider === id} onClick={() => setProvider(id)}><span className={`setup-provider-icon ${id}`}><Sparkles size={22}/></span><span><strong>{agentLabel(id)}</strong><small>{id === 'codex' ? 'In ChatGPT desktop or the Codex app' : 'The Code tab in Claude Desktop'}</small>{apps.find(app => app.provider === id)?.installed && <em>Installed on this Mac</em>}</span><span className="setup-radio">{provider === id && <Check size={12}/>}</span></button>)}</fieldset>
              <p className="setup-caption">Your agent needs a signed-in account. Cloud chats cannot reach this local board.</p>
              <div className="field"><label htmlFor="setup-frequency">When should it look for jobs?</label><select id="setup-frequency" value={frequency} onChange={event => setFrequency(event.target.value)}><option value="demand">Only when I ask</option><option value="weekdays">Every weekday</option><option value="daily">Every day</option><option value="custom">Choose my own schedule</option></select></div>
              {frequency !== 'demand' && <div className="field-row"><div className="field"><label htmlFor="setup-time">{frequency === 'custom' ? 'Schedule' : 'Time'}</label>{frequency === 'custom' ? <input id="setup-time" maxLength={300} value={cadence} placeholder="Mondays at 10:00" onChange={event => setCadence(event.target.value)}/> : <input id="setup-time" type="time" required value={time} onChange={event => setTime(event.target.value)}/>}</div><div className="field"><label htmlFor="setup-timezone">Timezone</label><input id="setup-timezone" maxLength={100} required value={timezone} onChange={event => setTimezone(event.target.value)}/></div></div>}
              <div className="setup-note"><CheckCheck size={18}/><p>{frequency === 'demand' ? 'You stay in control. Ask your agent whenever you want fresh opportunities.' : 'Your agent will create the schedule after you send the setup request. Keep your computer awake and the agent running for scheduled searches.'}</p></div>
              {state.schedule.taskId && <p className="setup-caption">Existing task: {state.schedule.taskId}. Changing the schedule asks the agent to update it. Pause and unlink it in Search agent before switching providers or to on-demand.</p>}
            </>}
            {step === 2 && <>
              <div className="setup-connect-card"><div className={`setup-status-icon ${configured || confirmed ? 'done' : ''}`}>{configured || confirmed ? <Check size={20}/> : <Plug size={20}/>}</div><div><h3>{confirmed ? `${label} confirmed the connection` : configured ? `Connection added to ${label}` : `Connect ${label} to your board`}</h3><p>{confirmed ? 'The agent reached this exact database.' : configured ? 'Your connection is saved. Open a new conversation below to start.' : selectedApp?.canConnect ? 'The button below adds the connection and opens your agent. Your other settings stay in place.' : 'Add the connection in Advanced connection below, then copy the setup request.'}</p></div></div>
              {!selectedApp?.canConnect && !configured && !confirmed && <p className="setup-caption">{window.nextstepDesktop ? 'Install the desktop agent, then reopen Nextstep. You can also connect manually below.' : 'Using Nextstep in a browser? Add the connection manually below. The Mac app can do this for you.'} <a href={provider === 'codex' ? 'https://learn.chatgpt.com/docs/extend/mcp?surface=cli' : 'https://code.claude.com/docs/en/desktop'} target="_blank" rel="noreferrer">Agent setup guide <ExternalLink size={12}/></a></p>}
              <div className="setup-handoff"><h3>Start your first search</h3><p>{selectedApp?.canConnect ? agentHandoffHint(provider) : `Paste the request into a new local ${provider === 'claude-code' ? 'conversation in Claude Desktop’s Code tab' : 'Codex task'} and send it.`} Your agent will use your preferences{state.schedule.cadence ? ', create the schedule,' : ''} and run your first search.</p><button type="button" className={selectedApp?.canConnect || configured || confirmed || manualReady ? 'primary-button setup-wide' : 'secondary-button setup-wide'} disabled={!selectedApp?.canConnect && !configured && !confirmed && !manualReady} onClick={() => { void copySetup(Boolean(selectedApp?.canConnect)); }}>{requestReady ? <Check size={16}/> : selectedApp?.canConnect ? <ExternalLink size={16}/> : <Copy size={16}/>}{selectedApp?.canConnect ? `Open setup in ${label}` : 'Copy setup request'}</button>
              {setupText && <details className="setup-details" open={!requestReady}><summary>View setup request</summary><textarea className="agent-setup-text" aria-label="Setup request" readOnly value={setupText} rows={8}/><button className="secondary-button" type="button" onClick={() => { void copySetup(); }}>Copy request</button></details>}</div>
              <div className="setup-checklist" aria-label="Agent setup status" aria-live="polite"><div><span className={confirmed ? 'done' : ''}>{confirmed ? <Check size={14}/> : <span/>}</span>{confirmed ? 'Agent connection confirmed' : 'Waiting for your agent to connect'}</div>{state.schedule.cadence && <div><span className={state.schedule.reportedAt ? 'done' : ''}>{state.schedule.reportedAt ? <Check size={14}/> : <span/>}</span>{state.schedule.reportedAt ? 'Agent reported the scheduled task' : 'Waiting for the agent to report its schedule'}</div>}<div><span className={state.runs.length ? 'done' : ''}>{state.runs.length ? <Check size={14}/> : <span/>}</span>{state.runs.length ? `Latest search: ${state.runs[0].importedIds.length} new matches saved` : 'First search will appear on your board'}</div></div>
              <details className="setup-details"><summary>Advanced connection</summary><p className="setup-caption">{provider === 'codex' ? 'Merge this into ~/.codex/config.toml, or add the server in Codex MCP settings.' : 'Merge this server into ~/.claude.json for Claude Code. Preserve your existing settings.'} Then restart your agent or open a new local task.</p><pre className="agent-config">{connectionText(state)}</pre><button className="secondary-button" type="button" onClick={() => { navigator.clipboard.writeText(connectionText(state)).then(() => setNotice('Connection settings copied.')).catch(() => setError('Select and copy the connection settings above.')); }}>Copy connection settings</button><label className="setup-checkbox"><input type="checkbox" checked={manualReady} onChange={event => setManualReady(event.target.checked)}/>I added the connection in my agent</label><p className="setup-caption">Database: {state.database}</p></details>
              <div className="setup-note"><Sparkles size={18}/><p>Move matches to <strong>Interested</strong> or <strong>Uninterested</strong>. Your agent uses those choices to improve its next search. It won’t apply for you.</p></div>
            </>}
          </fieldset>}
        </div>
        <div className="setup-footer">
          {error && <div className="form-error" role="alert">{error}</div>}{notice && <output className="agent-notice">{notice}</output>}
          <div className="setup-actions">{step > 0 && state ? <button className="setup-text-button" type="button" disabled={busy} onClick={() => { setStep(step-1); setError(''); setNotice(''); }}><ArrowLeft size={15}/>Back</button> : <button className="setup-text-button" type="button" disabled={busy || !state} onClick={close}>Use the board for now</button>}
            {!state && error ? <button className="secondary-button" type="button" onClick={() => { setError(''); setAttempt(value => value+1); }}>Retry loading</button> : step < 2 ? <button className="primary-button" type="submit" disabled={busy || !state}>{busy ? <LoaderCircle size={16} className="spin"/> : null}Continue <ArrowRight size={15}/></button> : <button className="primary-button" type="button" disabled={busy} onClick={() => { void finish('complete'); }}>Go to my board <ArrowRight size={15}/></button>}
          </div><p className="setup-footer-note">{step === 2 ? 'You can return to this anytime from Search agent.' : 'Saved on this device. You can change everything later.'}</p>
        </div>
      </form>
    </div>
  </DialogContent></Dialog>
  <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Leave setup for now?</AlertDialogTitle><AlertDialogDescription>Your saved steps will be here when you return. Changes on this step haven’t been saved.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { void finish('dismissed'); }}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
