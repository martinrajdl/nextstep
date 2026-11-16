import { useEffect, useState } from 'react';
import AppButton from '@/components/app-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { request } from '@/lib/model';
import { useHostedSession } from '@/components/hosted-session';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';

type Token = { id: string; label: string; expires_at: string; revoked_at: string|null };
export default function HostedAgentConnection() {
  const session = useHostedSession();
  const [label, setLabel] = useState('My agent');
  const [secret, setSecret] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [runtime, setRuntime] = useState<'app'|'source'>('app');
  const [executable, setExecutable] = useState('/Applications/Nextstep.app/Contents/MacOS/Nextstep');
  const [script, setScript] = useState('');
  const [credentialFile, setCredentialFile] = useState('');
  const [copied, setCopied] = useState('');
  const connection = JSON.stringify({mcpServers:{'nextstep-shared':{
    command: runtime === 'app' ? executable : 'node',
    args: [
      ...(runtime === 'app' ? ['--crm-mcp'] : [script || '/absolute/path/to/nextstep/mcp/crm-stdio.mjs']),
      '--server', location.origin, '--workspace', session?.workspace.id,
      '--credential-file', credentialFile || '/absolute/path/to/private/nextstep-shared',
    ],
  }}},null,2);
  const validPaths = credentialFile.startsWith('/') && (runtime === 'app' ? executable.startsWith('/') : script.startsWith('/'));
  async function copy(value: string, name: string) {
    try { await navigator.clipboard.writeText(value); setCopied(name); setError(''); }
    catch { setError('Clipboard unavailable. Select and copy the text below.'); }
  }
  useEffect(() => { void request<{tokens:Token[]}>('/api/account/agent-tokens').then(value => setTokens(value.tokens)).catch(() => setError('Could not load agent connections.')); },[]);
  async function create() {
    if (busy) return;
    setBusy(true); setError(''); setSecret('');
    try {
      const value = await request<Token & {token:string}>('/api/account/agent-tokens','POST',{ label });
      setSecret(value.token); setTokens(previous => [value,...previous]);
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not create the connection.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError('');
    try {
      await request(`/api/account/agent-tokens/${id}`,'DELETE',{});
      setTokens(previous => previous.filter(token => token.id !== id));
      setSecret('');
    } catch (value) { setError(value instanceof Error ? value.message : 'Could not revoke the connection.'); }
    finally { setBusy(false); }
  }
  if (session?.workspace.role === 'viewer') return <p>Your account has read-only access. Ask the workspace owner for editing access to connect an agent.</p>;
  return <div className="hosted-agent-token">
    <h2>Connect your agent</h2>
    <p>Use Codex, Claude Code or another local MCP agent with this shared workspace. Your agent connects over HTTPS; records and notes are saved here.</p>
    <p>Create a named connection with your editing permissions. It expires after 90 days and can be revoked below.</p>
    <Label>Connection name<Input value={label} maxLength={80} onChange={event => setLabel(event.target.value)}/></Label>
    <AppButton className="crm-button" disabled={busy || !label.trim()} onClick={() => void create()}>Create agent connection</AppButton>
    {secret && <div><p>Copy this credential now. It is shown once. Save it in a private file outside your repository and use that file below.</p><pre aria-label="New agent credential">{secret}</pre><div className="crm-manual-actions"><AppButton className="crm-button" onClick={() => void copy(secret,'credential')}>{copied === 'credential' ? 'Copied' : 'Copy credential'}</AppButton><AppButton className="crm-button" onClick={() => setSecret('')}>Hide credential</AppButton></div></div>}
    <div className="hosted-agent-setup">
      <h3>Connect from your computer</h3>
      <p>Save the credential as a plain text file readable only by your user. Enter its full path below. The credential stays out of the connection configuration.</p>
      <Label>Private credential file<Input aria-label="Private credential file" value={credentialFile} placeholder="/absolute/path/to/private/nextstep-shared" onChange={event => { setCredentialFile(event.target.value); setCopied(''); }}/></Label>
      <div className="crm-manual-actions" aria-label="Connector runtime"><AppButton className="crm-button" aria-pressed={runtime === 'app'} onClick={() => {setRuntime('app');setCopied('');}}>Nextstep app on macOS</AppButton><AppButton className="crm-button" aria-pressed={runtime === 'source'} onClick={() => {setRuntime('source');setCopied('');}}>Source checkout</AppButton></div>
      {runtime === 'app' ? <><p className="crm-hint">Requires Nextstep 0.5.2 or newer. Keep the app in its permanent location; it provides the connector without a separate Node installation.</p><Label>Nextstep executable<Input aria-label="Nextstep executable" value={executable} onChange={event => {setExecutable(event.target.value);setCopied('');}}/></Label></> : <><p className="crm-hint">Use Node 24 and a checkout with its dependencies installed.</p><Label>Connector script<Input aria-label="Connector script" value={script} placeholder="/absolute/path/to/nextstep/mcp/crm-stdio.mjs" onChange={event => {setScript(event.target.value);setCopied('');}}/></Label></>}
      <Collapsible className="crm-details"><CollapsibleTrigger>Connection configuration</CollapsibleTrigger><CollapsibleContent><pre aria-label="Hosted MCP configuration">{connection}</pre><p className="crm-hint">On macOS or Linux, run chmod 600 on the credential file before connecting.</p></CollapsibleContent></Collapsible>
      <AppButton className="crm-button" disabled={!validPaths} onClick={() => void copy(connection,'connection')}>{copied === 'connection' ? 'Copied' : 'Copy MCP connection'}</AppButton>
      <p>Add the connection to your agent’s MCP settings as nextstep-shared. Then ask it to read the workspace context and continue your work. Your local nextstep-crm connection stays separate.</p>
      <p className="crm-hint">Agent changes follow Require review in Settings. Access ends when this connection expires, is revoked, or your workspace access is removed.</p>
    </div>
    <ul className="hosted-token-list">{tokens.filter(token => !token.revoked_at).map(token => <li key={token.id}><span>{token.label}<small>Expires {new Date(token.expires_at).toLocaleDateString()}</small></span><AppButton className="crm-button" disabled={busy} onClick={() => void revoke(token.id)}>Revoke</AppButton></li>)}</ul>
    {error && <p className="crm-error" role="alert">{error}</p>}
  </div>;
}
