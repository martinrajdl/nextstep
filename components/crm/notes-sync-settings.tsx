import { useEffect, useState } from 'react';
import { Cloud } from 'lucide-react';
import AppButton from '@/components/app-button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { request } from '@/lib/model';
import { dateTime, errorMessage } from '@/lib/crm';
import type { NotesSync } from '@/lib/notes';

const stateLabels: Record<string, string> = {synced:'Up to date',error:'Needs attention',syncing:'Syncing…',pending:'Changes queued',unavailable:'Unavailable',disabled:'Off'};
export default function NotesSyncSettings() {
  const [sync, setSync] = useState<NotesSync | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const load = () => request<NotesSync>('/api/notes/sync')
      .then(value => { if (active) setSync(value); })
      .catch(value => { if (active) setError(errorMessage(value)); });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  async function change(action: () => Promise<NotesSync | null> | undefined) {
    if (busy) return;
    setBusy(true); setError('');
    try { const value = await action(); if (value) setSync(value); }
    catch (value) { setError(errorMessage(value)); }
    finally { setBusy(false); }
  }
  if (!sync?.available && !error) return null;
  return <section aria-labelledby="notes-sync-heading">
    <h3 id="notes-sync-heading"><Cloud size={18}/>Notes folder sync</h3>
    <p>Optionally keep Markdown copies in a folder you own. Notes are always saved in your selected database.</p>
    <p className="settings-note">Beta · Choose iCloud Drive or another synced folder for Mac-to-Mac transfer. Your file provider controls delivery to other devices.</p>
    {sync?.folder && <Label>Notes folder<Input aria-label="Notes folder" readOnly value={sync.folder}/></Label>}
    {sync?.enabled && <output>{stateLabels[sync.state] || 'Changes queued'}</output>}
    {sync?.lastSyncedAt && <p className="settings-note">Last checked {dateTime(sync.lastSyncedAt)}</p>}
    {(error || sync?.message) && <p className="crm-error" role="alert">{error || sync?.message}</p>}
    <div className="backend-actions">
      {!sync?.folder && <AppButton className="crm-button" disabled={busy || !sync?.available} onClick={() => void change(() => window.nextstepDesktop?.chooseNotesFolder())}>Choose folder…</AppButton>}
      {sync?.folder && <AppButton className="crm-button" disabled={busy} onClick={() => void change(() => request<NotesSync>('/api/notes/sync','PATCH',{enabled:!sync.enabled}))}>{sync.enabled ? 'Disable sync' : 'Enable folder sync'}</AppButton>}
      {sync?.enabled && <AppButton className="crm-button" disabled={busy} onClick={() => void change(() => request<NotesSync>('/api/notes/sync/run','POST',{}))}>Sync now</AppButton>}
      {Boolean(sync?.missingCount) && <AppButton className="crm-button" disabled={busy} onClick={() => void change(() => request<NotesSync>('/api/notes/sync','PATCH',{enabled:true,restoreMissing:true}))}>Restore missing files</AppButton>}
    </div>
    <p className="settings-note">Keep the folder downloaded on each Mac. Conflicts keep recovery copies. Removing a file does not delete a note; use Trash in Nextstep.</p>
  </section>;
}
