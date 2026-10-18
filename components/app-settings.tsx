import AppButton, { AppLink } from '@/components/app-button';
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Check, Download, RefreshCw, Database, Info, Monitor, Moon, Palette, Plug, Server, Sun, ShieldCheck } from 'lucide-react';
import Modal from './crm/modal';
import SearchPreferences from './search-preferences';
import AgentConnection from './agent-connection';
import { errorMessage, type UpdateState, type ThemePreference } from '@/lib/agent';
import { request } from '@/lib/model';
import type { Workspace } from '@/lib/crm';
import '../app/appearance.css';
import '../app/settings.css';

const presets = [
  ['Neutral', '#777777'],
  ['Green', '#839d4d'],
  ['Blue', '#4473cf'],
  ['Violet', '#8b68ba'],
  ['Rose', '#ba657f'],
  ['Slate', '#657486'],
] as const;
const preferenceKey = 'nextstep-appearance-v1';
const themeKey = 'nextstep-theme-v1';
const sidebarKey = 'nextstep-sidebar-collapsed';
function initialSidebarCollapsed() {
  try { return localStorage.getItem(sidebarKey) === 'true'; }
  catch { return false; }
}
const themes = [{value:'light',label:'Light',icon:Sun},{value:'dark',label:'Dark',icon:Moon},{value:'system',label:'System',icon:Monitor}] as const;
const validTheme = (value: unknown): value is ThemePreference => themes.some(theme => theme.value === value);
function initialTheme(): ThemePreference {
  try { const value = localStorage.getItem(themeKey); if (validTheme(value)) return value; }
  catch { /* Appearance also works without browser storage. */ }
  return 'light';
}
const validColor = (value: unknown): value is string =>
  typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value);
function initialAccent() {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (validColor(value)) return value;
  } catch {
    /* Browser storage may be disabled. */
  }
  return presets[0][1];
}
function colorCoordinates(hex: string) {
  const [r, g, b] = [1, 3, 5].map(
    (index) => parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b),
    delta = max - min;
  const lightness = (max + min) / 2;
  const saturation = delta ? delta / (1 - Math.abs(2 * lightness - 1)) : 0;
  const hue = !delta
    ? 0
    : max === r
      ? (((g - b) / delta + 6) % 6) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;
  return { hue, saturation: Math.min(1.6, saturation / 0.35) };
}
type Preferences = { updateAvailable: boolean; backendUrl: string | null; resolvedTheme: 'light'|'dark'; sidebarCollapsed: boolean; setSidebarCollapsed: (value: boolean) => Promise<void>; openSettings: () => void };
const PreferencesContext = createContext<Preferences>({
  updateAvailable: false,
  backendUrl: null,
  resolvedTheme: 'light',
  sidebarCollapsed: false,
  setSidebarCollapsed: async () => {},
  openSettings: () => {},
});
export const useAppPreferences = () => useContext(PreferencesContext);

function DataExports() {
  return <div className="settings-group">
    <div className="backend-actions"><AppLink tooltip="Export collections as JSON" className="crm-button" href="/api/crm/export" download><Download size={15}/>Export collections</AppLink></div>
    <p className="settings-note">Download all records, views, proposals and history as JSON. JSON exports are not a full database backup.</p>
  </div>;
}

function AgentSettings() {
  const [policy, setPolicy] = useState<Workspace['policy'] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    request<Workspace['policy']>('/api/crm/policy').then(value => { if (active) setPolicy(value); }).catch(e => { if (active) setError(errorMessage(e)); });
    return () => { active = false; };
  }, []);
  async function change(reviewRequired: boolean) {
    if (!policy || saving) return;
    const previous = policy;
    setPolicy({...policy, reviewRequired});
    setSaving(true); setError('');
    try {
      setPolicy(await request<Workspace['policy']>('/api/crm/policy', 'PATCH', {...policy, reviewRequired}));
      window.dispatchEvent(new Event('nextstep:policy'));
    } catch (e) {
      setPolicy(previous);
      setError(errorMessage(e));
      try { setPolicy(await request<Workspace['policy']>('/api/crm/policy')); } catch { /* Retain the last confirmed setting while offline. */ }
    }
    finally { setSaving(false); }
  }
  return <section>
    <h3><ShieldCheck size={18}/>Agent changes</h3>
    <label className="usage-consent"><input type="checkbox" checked={policy?.reviewRequired ?? false} disabled={!policy || saving} onChange={event => void change(event.target.checked)}/><span>Require review</span></label>
    {saving && <output className="settings-note">Saving…</output>}
    <p>Off by default. Your connected agents can create and update your workspace directly. Turn this on to approve their changes before they are saved.</p>
    <p className="settings-note">Applies to this database and its connected agents. Existing proposals still need a decision. Every applied change keeps its history.</p>
    {error && <p className="crm-error" role="alert">{error}</p>}
  </section>;
}

export default function AppSettings({ children }: { children: ReactNode }) {
  const [update, setUpdate] = useState<UpdateState | null>(null);
  const [accent, setAccent] = useState(initialAccent);
  const [theme, setTheme] = useState<ThemePreference>(initialTheme);
  const [sidebarCollapsed, updateSidebarCollapsed] = useState(initialSidebarCollapsed);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const resolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const [usageEnabled, setUsageEnabled] = useState(false);
  const [savingUsage, setSavingUsage] = useState(false);
  const [open, setOpen] = useState(false);
  const [existingCollection, setExistingCollection] = useState('');
  const [workflowPanel, setWorkflowPanel] = useState<'preferences'|'agent'|null>(null);
  useEffect(() => {
    if (!open) return;
    let active = true;
    request<Workspace>('/api/crm/context').then(value => { if (active) setExistingCollection(value.collections.find(c => c.id === value.compatibilityCollectionId)?.name || ''); }).catch(() => {});
    return () => { active = false; };
  }, [open]);
  const [connection, setConnection] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const openSettings = () => {
    setError('');
    setConnection(backendUrl || 'http://127.0.0.1:4319');
    setOpen(true);
  };
  useEffect(() => {
    const system = matchMedia('(prefers-color-scheme: dark)');
    const update = () => setSystemDark(system.matches);
    system.addEventListener('change', update);
    return () => system.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolvedTheme === 'dark' ? '#17191e' : '#ffffff');
    try { localStorage.setItem(themeKey, theme); } catch { /* Native settings are independent. */ }
  }, [theme, resolvedTheme]);
  useEffect(() => {
    const { hue, saturation } = colorCoordinates(accent);
    document.documentElement.style.setProperty('--accent-hue', hue.toFixed(2));
    document.documentElement.style.setProperty(
      '--accent-saturation',
      saturation.toFixed(3),
    );
    document.documentElement.dataset.accent = accent;
    try {
      localStorage.setItem(preferenceKey, accent);
    } catch {
      /* Native preferences still persist independently. */
    }
  }, [accent]);
  useEffect(() => {
    const desktop = window.nextstepDesktop;
    if (!desktop) return;
    let cancelled = false;
    desktop
      .getPreferences()
      .then((value) => {
        if (cancelled) return;
        if (validColor(value.accent)) setAccent(value.accent);
        if (validTheme(value.theme)) setTheme(value.theme);
        setUsageEnabled(value.usageEnabled === true);
        updateSidebarCollapsed(value.sidebarCollapsed === true);
        setBackendUrl(value.backendUrl);
        setConnection(value.backendUrl || 'http://127.0.0.1:4319');
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    const updates = desktop.onUpdateStateChanged(setUpdate);
    desktop.getUpdateState().then(value => { if (!cancelled) setUpdate(value); }).catch(() => {});
    const appearance = desktop.onAppearanceChanged((color) => {
      if (validColor(color)) setAccent(color);
    });
    const themeChanged = desktop.onThemeChanged((value) => {
      if (validTheme(value)) setTheme(value);
    });
    const settings = desktop.onOpenSettings(() => {
      setOpen(true);
      setError('');
    });
    return () => {
      cancelled = true;
      updates();
      appearance();
      themeChanged();
      settings();
    };
  }, []);
  async function setSidebarCollapsed(value: boolean) {
    if (window.nextstepDesktop) await window.nextstepDesktop.setSidebarCollapsed(value);
    updateSidebarCollapsed(value);
    try { localStorage.setItem(sidebarKey, String(value)); } catch { /* Native settings persist independently. */ }
  }
  async function chooseTheme(value: ThemePreference) {
    try {
      if (window.nextstepDesktop) await window.nextstepDesktop.setTheme(value);
      setTheme(value);
      setError('');
    } catch (e) { setError(errorMessage(e)); }
  }
  async function chooseUsage(enabled: boolean) {
    if (!window.nextstepDesktop) return;
    setSavingUsage(true);
    try { setUsageEnabled(await window.nextstepDesktop.setUsageEnabled(enabled)); setError(''); }
    catch (e) { setError(errorMessage(e)); }
    finally { setSavingUsage(false); }
  }
  async function chooseColor(color: string) {
    try {
      if (!validColor(color)) return;
      if (window.nextstepDesktop)
        await window.nextstepDesktop.setAppearance(color);
      setAccent(color);
      setError('');
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  async function connect(url: string | null) {
    if (!window.nextstepDesktop) return;
    setBusy(true);
    setError('');
    try {
      await window.nextstepDesktop.setBackend(url);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PreferencesContext value={{ backendUrl, resolvedTheme, sidebarCollapsed, setSidebarCollapsed, openSettings, updateAvailable: Boolean(update && ['available','ready'].includes(update.status)) }}>
      {children}
      {workflowPanel === 'preferences' && <SearchPreferences onClose={() => setWorkflowPanel(null)} onSaved={() => {}}/>}
      {workflowPanel === 'agent' && <AgentConnection onClose={() => setWorkflowPanel(null)} onSetup={() => {setWorkflowPanel(null); window.location.href='/#/agents';}}/>}
      {open && (
        <Modal
          title="Settings"
          subtitle="Make Nextstep feel like your workspace."
          className="app-settings-dialog"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="crm-form-body app-settings">
            <AgentSettings/>
            {update && <section className="app-update-settings">
              <h3><Download size={18}/>App updates <small className="settings-version">v{update.currentVersion}</small></h3>
              <output className={`update-status${update.status === 'error' ? ' settings-error-text' : ''}`}>{{idle:'Check for a newer version of Nextstep.',unsupported:'In-app updates are available in the signed macOS app.',checking:'Checking for updates…',current:'You’re up to date.',available:`Nextstep ${update.version} is available.`,downloading:'Downloading and verifying the update…',ready:`Nextstep ${update.version} is ready. Restart to finish updating.`,error:update.error}[update.status]}</output>
              {update.status !== 'unsupported' && <>
                <div className="backend-actions">
                  {update.status === 'ready' ? <AppButton className="crm-button crm-button-primary" onClick={() => void window.nextstepDesktop?.installUpdate().catch(e => setError(errorMessage(e)))}><RefreshCw size={15}/>Restart to update</AppButton> : update.status === 'available' ? <AppButton className="crm-button crm-button-primary" onClick={() => void window.nextstepDesktop?.downloadUpdate().then(setUpdate).catch(e => setError(errorMessage(e)))}><Download size={15}/>Download update</AppButton> : <AppButton className="crm-button" disabled={['checking','downloading'].includes(update.status)} onClick={() => void window.nextstepDesktop?.checkForUpdates().then(setUpdate).catch(e => setError(errorMessage(e)))}><RefreshCw size={15}/>{update.status === 'checking' ? 'Checking…' : update.status === 'downloading' ? 'Downloading…' : 'Check for updates'}</AppButton>}
                </div>
                <label className="usage-consent"><input type="checkbox" checked={update.automatic} onChange={event => void window.nextstepDesktop?.setAutomaticUpdates(event.target.checked).then(setUpdate).catch(e => setError(errorMessage(e)))}/><span>Check for updates automatically</span></label>
                <p className="settings-note">Checks use Electron’s update service. Downloads start when you choose. Your database stays on this computer or your own server. A downloaded update also installs the next time you quit and reopen Nextstep.</p>
              </>}
              <a href="https://github.com/martinrajdl/nextstep/releases/latest" target="_blank" rel="noreferrer">Release notes ↗</a>
            </section>}
            <section>
              <h3>
                <Palette size={18} /> Appearance
              </h3>
              <p>
                Choose a light or dark workspace, or follow your device.
              </p>
              <fieldset className="appearance-modes" aria-label="Color mode">
                {themes.map(({value,label,icon:Icon}) => <AppButton key={value} type="button" aria-label={`${label} mode`} aria-pressed={theme === value} onClick={() => void chooseTheme(value)}><Icon size={18}/><span>{label}</span>{theme === value && <Check size={14}/>}</AppButton>)}
              </fieldset>
              <fieldset className="appearance-accents">
                <legend>Accent color</legend>
                <p className="settings-note">Accent colors work in either mode. The app icon keeps its neutral colors.</p>
                <div className="appearance-presets">
                  {presets.map(([name, color]) => (
                    <AppButton
                      key={name}
                      type="button"
                      aria-label={`${name} accent`}
                      aria-pressed={accent === color}
                      onClick={() => void chooseColor(color)}
                    >
                      <span style={{ backgroundColor: color }}>
                        {accent === color && <Check size={16} />}
                      </span>
                      {name}
                    </AppButton>
                  ))}
                </div>
                <label className="custom-accent">
                  <span>Custom accent</span>
                  <input
                    aria-label="Custom accent color"
                    type="color"
                    value={accent}
                    onChange={(e) => void chooseColor(e.target.value)}
                  />
                  <code>{accent}</code>
                </label>
                <p className="settings-note">
                  Saved on this device. Text and surface shades adapt for
                  readability.
                </p>
              </fieldset>
            </section>
            <section>
              <h3>
                {backendUrl ? <Server size={18} /> : <Database size={18} />}{' '}
                Data & backend
              </h3>
              <div className="backend-status">
                <strong>
                  {backendUrl
                    ? 'Self-hosted backend'
                    : window.nextstepDesktop
                      ? 'Local SQLite database'
                      : 'Current server'}
                </strong>
                <small>
                  {backendUrl ||
                    (window.nextstepDesktop
                      ? 'Runs inside Electron on this computer.'
                      : window.location.origin)}
                </small>
              </div>
              <DataExports />
              {window.nextstepDesktop ? (
                <>
                  <p>
                    Connect to your own Nextstep server through an SSH tunnel.
                    The desktop interface stays on this computer; records stay
                    on the selected backend.
                  </p>
                  <label>
                    Backend tunnel address
                    <input
                      aria-label="Backend tunnel address"
                      type="url"
                      value={connection}
                      onChange={(e) => setConnection(e.target.value)}
                      placeholder="http://127.0.0.1:4319"
                      disabled={busy}
                    />
                  </label>
                  <div className="backend-actions">
                    <AppButton
                      className="crm-button crm-button-primary"
                      disabled={busy || !connection.trim()}
                      onClick={() => void connect(connection)}
                    >
                      {busy ? 'Connecting…' : 'Connect to backend'}
                    </AppButton>
                    {backendUrl && (
                      <AppButton
                        className="crm-button"
                        disabled={busy}
                        onClick={() => void connect(null)}
                      >
                        Use local database
                      </AppButton>
                    )}
                  </div>
                  <p className="settings-note">
                    Finish any open edits before switching. Databases stay
                    separate; switching does not copy or merge records.
                  </p>
                  <details className="crm-details">
                    <summary>How to self-host</summary>
                    <p>
                      Run Nextstep on your server with port 4319, then keep this
                      tunnel open on your computer:
                    </p>
                    <pre>ssh -N -L 4319:127.0.0.1:4319 user@your-server</pre>
                    <p>
                      Use the same port on both ends. Connect your agent over
                      SSH so it works with the server’s database.
                    </p>
                    <a
                      href="https://github.com/martinrajdl/nextstep/blob/main/docs/self-hosting.md"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Self-hosting guide ↗
                    </a>
                  </details>
                </>
              ) : (
                <p>
                  In Electron, use this panel to switch between the local
                  database and your own server. In a browser, the page address
                  selects the backend.
                </p>
              )}
            </section>
            {window.nextstepDesktop && <section>
              <h3><ShieldCheck size={18}/>Privacy</h3>
              <label className="usage-consent"><input type="checkbox" checked={usageEnabled} disabled={savingUsage} onChange={event => void chooseUsage(event.target.checked)}/><span>Share anonymous usage</span></label>
              <p>Optional and off by default. Send one daily check-in while using the app, with its version, operating system and a random identifier that changes each day. This helps us count active installations.</p>
              <p>No records, contacts, prompts, database paths or agent activity. Turning this off stops reporting and removes the local identifier.</p>
              <a href="https://github.com/martinrajdl/nextstep/blob/main/docs/privacy.md" target="_blank" rel="noreferrer">Exactly what is shared ↗</a>
            </section>}
            {existingCollection && <section><h3><Plug size={18}/>Connected importer</h3><p>Your existing connection uses {existingCollection}. Its saved preferences and schedule are preserved.</p><div className="backend-actions"><AppButton className="crm-button" onClick={() => {setOpen(false);setWorkflowPanel('preferences');}}>Importer preferences</AppButton><AppButton className="crm-button" onClick={() => {setOpen(false);setWorkflowPanel('agent');}}>Connection & schedule</AppButton></div></section>}
            <section><h3><Info size={18}/>About Nextstep</h3><p>An open-source CRM for your agent. You choose which agents have access.</p><a href="https://github.com/martinrajdl/nextstep" target="_blank" rel="noreferrer">View source on GitHub ↗</a></section>
            {error && (
              <p role="alert" className="crm-error">
                {error}
              </p>
            )}
          </div>
          <footer>
            <AppButton
              className="crm-button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Done
            </AppButton>
          </footer>
        </Modal>
      )}
    </PreferencesContext>
  );
}
