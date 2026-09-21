import { useEffect, useState, type SubmitEvent } from 'react';
import { Check, SlidersHorizontal } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import { request } from '@/lib/model';
import { profileDraft, profileFields, type SearchProfile, type SearchProfileDraft } from '@/lib/search-profile';

type Props = { onClose: () => void; onSaved: (profile: SearchProfile) => void };

export default function SearchPreferences({ onClose, onSaved }: Props) {
  const [profile, setProfile] = useState<SearchProfile | null>(null);
  const [draft, setDraft] = useState<SearchProfileDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [discard, setDiscard] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const dirty = Boolean(profile && draft && JSON.stringify(profileDraft(profile)) !== JSON.stringify(draft));

  useEffect(() => {
    let cancelled = false;
    request<{ profile: SearchProfile }>('/api/profile').then(({profile: saved}) => {
      if (!cancelled) { setProfile(saved); setDraft(profileDraft(saved)); setError(''); }
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load your preferences.'); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  function close() { if (!busy) { if (dirty) setDiscard(true); else onClose(); } }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile || !draft || busy) return;
    setBusy(true); setError('');
    try {
      const result = await request<{profile: SearchProfile}>('/api/profile', 'PATCH', {...draft, version: profile.version});
      onSaved(result.profile); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not save your preferences.'); }
    finally { setBusy(false); }
  }

  return <><Sheet open onOpenChange={open => { if (!open) close(); }}>
    <SheetContent className="opportunity-sheet preferences-sheet">
      <SheetHeader className="editor-header">
        <div className="editor-eyebrow">YOUR SEARCH</div>
        <div className="editor-heading"><span className="editor-icon"><SlidersHorizontal size={21}/></span><SheetTitle>Search preferences</SheetTitle></div>
        <SheetDescription>Tell us what you want next. Your search agent uses these saved preferences.</SheetDescription>
      </SheetHeader>
      <form className="editor-form" aria-label="Search preferences" onSubmit={save}>
        <div className="editor-scroll">
          {draft ? <fieldset disabled={busy}>
            {profileFields.map(({key, label, hint, maxLength}) => <div className="field" key={key}>
              <label htmlFor={`profile-${key}`}>{label}</label>
              <p className="field-hint" id={`profile-${key}-hint`}>{hint}</p>
              <Textarea id={`profile-${key}`} aria-describedby={`profile-${key}-hint`} rows={key === 'experience' ? 3 : 2} maxLength={maxLength} value={draft[key]} onChange={event => setDraft(current => current && ({...current, [key]: event.target.value}))}/>
            </div>)}
            <p className="preferences-privacy">Saved privately on this device. Leave anything you haven’t decided blank.</p>
          </fieldset> : <output>{error ? 'Preferences could not be loaded.' : 'Loading preferences…'}</output>}
        </div>
        <div className="editor-footer">
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="editor-actions">
            {!draft && error && <button className="secondary-button" type="button" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Retry loading</button>}
            <button className="secondary-button cancel-button" type="button" onClick={close} disabled={busy}>Cancel</button>
            <button className="primary-button" type="submit" disabled={busy || !draft}><Check size={16}/>{busy ? 'Saving…' : 'Save preferences'}</button>
          </div>
        </div>
      </form>
    </SheetContent>
  </Sheet>
    <AlertDialog open={discard} onOpenChange={setDiscard}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Discard your changes?</AlertDialogTitle><AlertDialogDescription>Your search preferences haven’t been saved.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={onClose}>Discard changes</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
