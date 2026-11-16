import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { request } from '@/lib/model';
import nextstepIcon from '@/desktop/icons/nextstep-ui.png';
import '../app/hosted.css';

type HostedWorkspace = { id: string; name: string; role: 'owner'|'editor'|'viewer' };
type Session = { mode: 'hosted'; authenticated: boolean; user?: { id: string; email: string }; workspaces?: HostedWorkspace[] };
type HostedSession = { user: { id: string; email: string }; workspace: HostedWorkspace };
const HostedContext = createContext<HostedSession | null>(null);
export const useHostedSession = () => useContext(HostedContext);

export async function signOutHosted() {
  await request('/api/auth/logout','POST',{});
  window.location.assign('/');
}

export default function HostedGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'checking'|'local'|'hosted'|'error'>(window.nextstepDesktop ? 'local' : 'checking');
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (window.nextstepDesktop) return;
    let active = true;
    let hosted = false;
    const load = () => fetch('/api/auth/session',{ cache: 'no-store', signal: AbortSignal.timeout(15000) }).then(async response => {
      if (!active) return;
      if (response.status === 404) { setState('local'); return; }
      if (!response.ok) throw new Error('Could not check your account. Please try again.');
      const data = await response.json() as Session;
      if ((data as {mode:string}).mode === 'local') { setState('local'); return; }
      if (data.mode !== 'hosted') throw new Error('Could not check your account. Please try again.');
      hosted = true;
      if (active) { setSession(data); setState('hosted'); }
    }).catch(value => { if (active) { setError(value.message); setState('error'); } });
    void load();
    const recheck = () => { if (hosted) { setState('checking'); setSession(null); void load(); } };
    window.addEventListener('nextstep:auth-required',recheck);
    return () => { active = false; window.removeEventListener('nextstep:auth-required',recheck); };
  },[]);
  if (state === 'local') return children;
  if (state === 'checking') return <main className="hosted-signin"><output>Opening Nextstep…</output></main>;
  const workspace = session?.workspaces?.[0];
  if (state === 'hosted' && session?.authenticated && session.user && workspace)
    return <HostedContext value={{ user: session.user, workspace }}>{children}</HostedContext>;
  const denied = state === 'hosted' && session?.authenticated;
  return <main className="hosted-signin"><section className="hosted-signin-card">
    <img src={nextstepIcon} alt="" width="64" height="64" />
    <h1>{denied ? 'An invitation is needed.' : 'Sign in to Nextstep.'}</h1>
    <p>{denied ? 'This Apple account has not been invited to a workspace. Ask the workspace owner to add your sign-in email.' : 'Open your shared workspace with your invited Apple account.'}</p>
    {state === 'error' ? <><p role="alert">{error}</p><button onClick={() => window.location.reload()}>Try again</button></> : <>
      {denied && <p className="hosted-signin-email">{session.user?.email}</p>}
      {denied ? <button onClick={() => void signOutHosted().catch(value => setError(value.message))}>Use another account</button> : <a className="hosted-apple-button" href="/api/auth/login"><svg width="18" height="22" viewBox="0 0 24 28" fill="currentColor" aria-hidden="true"><path d="M17.5 4.8c1-1.2 1.7-2.8 1.5-4.4-1.5.1-3.3 1-4.4 2.2-.9 1-1.8 2.7-1.5 4.2 1.7.1 3.4-.9 4.4-2M22.9 19c-.5 1.2-.8 1.8-1.5 2.9-1 1.6-2.4 3.6-4.2 3.7-1.7 0-2.1-1.1-4.4-1.1s-2.7 1.1-4.4 1.1c-1.8 0-3.1-1.8-4.1-3.4C1.5 17.8 1 12.3 2.7 9.4c1.2-2.1 3.1-3.3 5-3.3 1.9 0 3.1 1.1 4.7 1.1 1.5 0 2.5-1.1 4.7-1.1 1.7 0 3.5.9 4.7 2.4-4.1 2.3-3.4 8.2 1.1 10.5"/></svg> Continue with Apple</a>}
      {!denied && <p className="hosted-signin-note">Choose Share My Email when signing in for the first time.</p>}
      {new URLSearchParams(window.location.search).has('signin') && <p role="alert">Sign-in did not finish. Please try again.</p>}
      {error && <p role="alert">{error}</p>}
    </>}
  </section></main>;
}
