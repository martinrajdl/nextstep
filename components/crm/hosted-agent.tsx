import { useEffect, useState } from 'react';
import AppButton from '@/components/app-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { request } from '@/lib/model';
import { useHostedSession } from '@/components/hosted-session';

type Token = { id: string; label: string; expires_at: string; revoked_at: string|null };
export default function HostedAgentConnection() {
  const session = useHostedSession();
  const [label, setLabel] = useState('My agent');
  const [secret, setSecret] = useState('');
  const [tokens, setTokens] = useState<Token[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    <p>Create a connection for your agent. It can access this workspace with your editing permissions and expires after 90 days.</p>
    <Label>Connection name<Input value={label} maxLength={80} onChange={event => setLabel(event.target.value)}/></Label>
    <AppButton className="crm-button" disabled={busy || !label.trim()} onClick={() => void create()}>Create agent connection</AppButton>
    {secret && <div><p>Copy this credential now. It is shown once. Save it in a private file outside your repository and use that file with the connection below.</p><pre aria-label="New agent credential">{secret}</pre><AppButton className="crm-button" onClick={() => setSecret('')}>Hide credential</AppButton></div>}
    <ul className="hosted-token-list">{tokens.filter(token => !token.revoked_at).map(token => <li key={token.id}><span>{token.label}<small>Expires {new Date(token.expires_at).toLocaleDateString()}</small></span><AppButton className="crm-button" disabled={busy} onClick={() => void revoke(token.id)}>Revoke</AppButton></li>)}</ul>
    {error && <p className="crm-error" role="alert">{error}</p>}
  </div>;
}
