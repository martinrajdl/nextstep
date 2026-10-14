import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  Code2,
  Copy,
  FileJson,
  Sparkles,
} from 'lucide-react';
import { request } from '@/lib/model';
import { agentLabel, type DesktopAgent, type Provider } from '@/lib/agent';
import { crmAgentRequest } from '@/lib/crm-agent-request';
import {
  errorMessage,
  newChange,
  type Change,
  type Collection,
  type Diff,
  type Workspace,
} from '@/lib/crm';
import Modal from './modal';
import { DiffView } from './review';
import { useAppPreferences } from '@/components/app-settings';
export function ChangeWorkbench({
  collection,
  onClose,
  onSaved,
}: {
  collection?: Collection;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [json, setJson] = useState(
    collection
      ? JSON.stringify(
          { records: [{ title: 'A new record', values: {} }] },
          null,
          2,
        )
      : JSON.stringify(
          {
            title: 'Create a collection',
            summary: 'Describe what this change does.',
            actor: 'Agent',
            operations: [
              {
                type: 'create_collection',
                id: 'reading_list',
                name: 'Reading list',
                fields: [{ key: 'source', name: 'Source', type: 'url' }],
              },
            ],
          },
          null,
          2,
        ),
  );
  const [preview, setPreview] = useState<{
      change: Change;
      diffs: Diff[];
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [dirty, setDirty] = useState(false);
  async function validate() {
    setError('');
    setBusy(true);
    try {
      const input = JSON.parse(json);
      let change;
      if (
        collection &&
        (Array.isArray(input) || Array.isArray(input.records))
      ) {
        const records = Array.isArray(input) ? input : input.records;
        change = newChange(
          `Import ${records.length} records into ${collection.name}`,
          records.map((record: Record<string, unknown>) => ({
            type: 'create_record',
            collectionId: collection.id,
            collectionVersion: collection.version,
            ...record,
          })),
        );
      } else {
        change = { id: crypto.randomUUID(), ...input };
      }
      const result = await request<{ change: Change; diffs: Diff[] }>(
        '/api/crm/preview',
        'POST',
        change,
      );
      setPreview(result);
    } catch (e) {
      setError(errorMessage(e));
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await request('/api/crm/proposals', 'POST', preview.change);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={collection ? 'Import & shape data' : 'Shape data with JSON'}
      subtitle="Paste agent output, validate it, and send it to the review inbox."
      onClose={onClose}
      dirty={dirty}
    >
      <div className="crm-form-body">
        <label className="crm-file-input">
          Load a JSON file
          <input
            aria-label="Load JSON file"
            type="file"
            accept=".json,application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 500000) {
                setError('Choose a JSON file smaller than 500 KB.');
                return;
              }
              try {
                setJson(await file.text());
                setPreview(null);
                setDirty(true);
              } catch {
                setError('Could not read this file.');
              }
            }}
          />
        </label>
        <label>
          Change set
          <textarea
            aria-label="Change set"
            className="crm-code-input"
            rows={12}
            spellCheck={false}
            value={json}
            onChange={(e) => {
              setJson(e.target.value);
              setPreview(null);
              setDirty(true);
            }}
          />
        </label>
        <p className="crm-hint">
          {collection
            ? 'Import { "records": [{ "title": "…", "values": { … }, "externalKey": "…" }] } or a full change set.'
            : 'A change set supports collection schemas, records, relations and saved views. Your agent can discover the full contract through MCP.'}
        </p>
        {error && (
          <p role="alert" className="crm-error">
            {error}
          </p>
        )}
        {preview && (
          <section>
            <div className="crm-preview-valid">
              <Check size={16} />
              Validated · {preview.diffs.length} operations · no records changed
            </div>
            {preview.diffs.map((diff, index) => (
              <DiffView key={index} diff={diff} />
            ))}
          </section>
        )}
      </div>
      <footer>
        <button
          className="crm-button"
          onClick={() => void validate()}
          disabled={busy}
        >
          <Code2 size={15} />
          Validate & preview
        </button>
        <button
          className="crm-button crm-button-primary"
          disabled={!preview || busy}
          onClick={() => void submit()}
        >
          <ArrowRight size={15} />
          Send to review
        </button>
      </footer>
    </Modal>
  );
}
export default function AgentTools({ workspace, onWorkbench, onNewCollection, onReview }: {
  workspace: Workspace;
  onWorkbench: () => void;
  onNewCollection: () => void;
  onReview: () => void;
}) {
  const { backendUrl } = useAppPreferences();
  const [agents, setAgents] = useState<DesktopAgent[]>([]);
  const [opening, setOpening] = useState<Provider | null>(null);
  const [opened, setOpened] = useState<Provider | null>(null);
  const [copied, setCopied] = useState('');
  const [error, setError] = useState('');
  const [trusted, setTrusted] = useState(false);
  const [sshHost, setSshHost] = useState('user@your-server');
  useEffect(() => {
    let active = true;
    window.nextstepDesktop?.getAgents().then(value => { if (active) setAgents(value); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  const configuration = structuredClone(workspace.connection) as { mcpServers: Record<string, { command: string; args: string[] }> };
  if (trusted) configuration.mcpServers['nextstep-crm'].args.push('--allow-writes');
  if (backendUrl) {
    const connection = configuration.mcpServers['nextstep-crm'];
    const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
    configuration.mcpServers['nextstep-crm'] = { command:'ssh', args:['-T','--',sshHost,[connection.command,...connection.args].map(quote).join(' ')] };
  }
  async function openAgent(provider: Provider) {
    if (!window.nextstepDesktop || opening) return;
    setOpening(provider); setError('');
    try { await window.nextstepDesktop.openCrmAgent(provider); setOpened(provider); }
    catch (e) { setError(errorMessage(e)); }
    finally { setOpening(null); }
  }
  async function copy(value: string, label: string) {
    try { await navigator.clipboard.writeText(value); setCopied(label); setError(''); }
    catch { setError('Clipboard unavailable. Select and copy the text below.'); }
  }
  const awaitingReview = workspace.pendingCount > 0;
  const progress = workspace.recentFlows[0];
  return <section className="crm-agent-start">
    <div className="crm-start-symbol"><Bot size={28}/></div>
    <h1>{awaitingReview ? 'Ready for your review.' : 'Connect your agent.'}</h1>
    <p className="crm-start-description">{awaitingReview ? 'Your agent has proposed changes. Take a look before they become part of your workspace.' : 'Tell it what you want to track. Your agent builds the structure and brings the information here.'}</p>
    {awaitingReview ? <button className="crm-button crm-button-primary crm-review-start" onClick={onReview}>Review {workspace.pendingCount === 1 ? 'proposed changes' : `${workspace.pendingCount} proposals`}<ArrowRight size={17}/></button> : <div className="crm-connect-options">
      {(['codex','claude-code'] as const).map(provider => {
        const available = agents.some(agent => agent.provider === provider && agent.canConnect);
        return <button className="crm-connect-option" key={provider} disabled={!available || Boolean(opening)} onClick={() => void openAgent(provider)}>
          {provider === 'codex' ? <Bot size={23}/> : <Sparkles size={23}/>}<span><strong>{opening === provider ? 'Opening…' : `Connect ${agentLabel(provider)}`}</strong><small>{available ? 'Open a setup conversation' : 'Requires the desktop app'}</small></span><ArrowRight size={17}/>
        </button>;
      })}
    </div>}
    <output className="crm-setup-status">
      {progress ? <span><span className="crm-progress-dot"/> {progress.message || 'Your agent is working on your workspace.'}</span> : opened ? <span>Send the prepared request in {agentLabel(opened)}. Your agent will ask what you want to track. Come back here to review its proposal.</span> : <span>{backendUrl ? 'For a self-hosted workspace, connect over SSH below.' : window.nextstepDesktop ? 'Use an agent you already have. Your information stays on this computer.' : 'Open the Nextstep desktop app for one-click setup, or connect another agent below.'}</span>}
    </output>
    {error && <p className="crm-error" role="alert">{error}</p>}
    <ol className="crm-start-steps" aria-label="Getting started">
      <li><span>1</span>Connect your agent</li><li><span>2</span>Tell it what you need</li><li><span>3</span>Review your workspace</li>
    </ol>
    <details className="crm-advanced-setup">
      <summary>Other agents & advanced setup</summary>
      <div className="crm-advanced-body">
        <h2>Connect another agent</h2>
        <p>Add this connection to your agent’s MCP settings, then send it the setup request below.</p>
        {backendUrl && <label>SSH host<input aria-label="SSH host" value={sshHost} onChange={event => setSshHost(event.target.value.replace(/[^a-zA-Z0-9_.@-]/g,''))}/></label>}
        <pre>{JSON.stringify(configuration,null,2)}</pre>
        <button className="crm-button" onClick={() => void copy(JSON.stringify(configuration,null,2),'config')}><Copy size={15}/>{copied === 'config' ? 'Copied' : 'Copy connection'}</button>
        <label className="crm-checkbox-label"><input type="checkbox" checked={trusted} onChange={e => setTrusted(e.target.checked)}/>Generate a trusted-write configuration</label>
        <p className="crm-hint">{trusted ? 'Lets a trusted agent save changes without review. Enable this in your agent only when you intend to give it direct write access.' : 'Your agent can read information and propose changes. You approve before anything is saved.'}</p>
        <button className="crm-button" onClick={() => void copy(crmAgentRequest,'prompt')}><Copy size={15}/>{copied === 'prompt' ? 'Copied' : 'Copy setup request'}</button>
        <details className="crm-details"><summary>Read setup request</summary><p className="crm-generated-brief">{crmAgentRequest}</p></details>
        <hr/>
        <h2>Manual tools</h2>
        <div className="crm-manual-actions"><button className="crm-button" onClick={onNewCollection}>Create a collection</button><button className="crm-button" onClick={onWorkbench}><FileJson size={16}/>Open JSON workbench</button></div>
      </div>
    </details>
  </section>;
}
