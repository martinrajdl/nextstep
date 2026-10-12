import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { Check, Database, Palette, Server } from 'lucide-react';
import Modal from './crm/modal';
import { errorMessage } from '@/lib/agent';
import '../app/appearance.css';

const presets = [
  ['Neutral', '#777777'],
  ['Green', '#839d4d'],
  ['Blue', '#4473cf'],
  ['Violet', '#8b68ba'],
  ['Rose', '#ba657f'],
  ['Slate', '#657486'],
] as const;
const preferenceKey = 'nextstep-appearance-v1';
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
type Preferences = { backendUrl: string | null; openSettings: () => void };
const PreferencesContext = createContext<Preferences>({
  backendUrl: null,
  openSettings: () => {},
});
export const useAppPreferences = () => useContext(PreferencesContext);

export default function AppSettings({ children }: { children: ReactNode }) {
  const [accent, setAccent] = useState(initialAccent);
  const [backendUrl, setBackendUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const openSettings = () => {
    setError('');
    setConnection(backendUrl || 'http://127.0.0.1:4319');
    setOpen(true);
  };
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
        setBackendUrl(value.backendUrl);
        setConnection(value.backendUrl || 'http://127.0.0.1:4319');
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    const appearance = desktop.onAppearanceChanged((color) => {
      if (validColor(color)) setAccent(color);
    });
    const settings = desktop.onOpenSettings(() => {
      setOpen(true);
      setError('');
    });
    return () => {
      cancelled = true;
      appearance();
      settings();
    };
  }, []);
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
    <PreferencesContext value={{ backendUrl, openSettings }}>
      {children}
      {open && (
        <Modal
          title="Settings"
          subtitle="Make Nextstep feel like your workspace."
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <div className="crm-form-body app-settings">
            <section>
              <h3>
                <Palette size={18} /> Appearance
              </h3>
              <p>
                Choose the accent used across your workspace. The app icon
                always keeps its neutral colors.
              </p>
              <div className="appearance-presets" aria-label="Accent colors">
                {presets.map(([name, color]) => (
                  <button
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
                  </button>
                ))}
              </div>
              <label className="custom-accent">
                Custom accent
                <input
                  aria-label="Custom accent color"
                  type="color"
                  value={accent}
                  onChange={(e) => void chooseColor(e.target.value)}
                />
                <code>{accent}</code>
              </label>
              <p className="crm-hint">
                Saved on this device. Text and surface shades adapt for
                readability.
              </p>
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
                    <button
                      className="crm-button crm-button-primary"
                      disabled={busy || !connection.trim()}
                      onClick={() => void connect(connection)}
                    >
                      {busy ? 'Connecting…' : 'Connect to backend'}
                    </button>
                    {backendUrl && (
                      <button
                        className="crm-button"
                        disabled={busy}
                        onClick={() => void connect(null)}
                      >
                        Use local database
                      </button>
                    )}
                  </div>
                  <p className="crm-hint">
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
            {error && (
              <p role="alert" className="crm-error">
                {error}
              </p>
            )}
          </div>
          <footer>
            <button
              className="crm-button"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              Done
            </button>
          </footer>
        </Modal>
      )}
    </PreferencesContext>
  );
}
