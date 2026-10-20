import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import AppButton from '@/components/app-button';
import { useEffect, useState, type SubmitEvent } from 'react';
import { ArrowUpRight, Building2, Check, Clock3, Trash2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { blankDraft, request, stageInfo, STAGES, type PipelineStage, type Activity, type Draft, type Opportunity, type StageId } from '@/lib/model';
import { CompanyMark } from './job-board';

type Props = { stages?: readonly PipelineStage[]; opportunity: Opportunity | null; stage: StageId; onClose: () => void; onSave: (draft: Draft, existing: Opportunity | null) => Promise<void>; onDelete: (job: Opportunity) => Promise<void> };
export default function OpportunityEditor({ stages = STAGES, opportunity, stage, onClose, onSave, onDelete }: Props) {
  const [initial] = useState<Draft>(() => opportunity ? { ...opportunity } : blankDraft(stage));
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState<'discard'|'delete'|null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [activityError, setActivityError] = useState(false);
  const dirty = JSON.stringify(initial) !== JSON.stringify(draft);
  useEffect(() => {
    if (!opportunity) return;
    let cancelled = false;
    request<{activity: Activity[]}>(`/api/opportunities/${opportunity.id}/activity`).then(data => { if (!cancelled) setActivity(data.activity); }).catch(() => { if (!cancelled) setActivityError(true); });
    return () => { cancelled = true; };
  }, [opportunity]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  function field<K extends keyof Draft>(key: K, value: Draft[K]) { setDraft(current => ({ ...current, [key]: value })); }
  function close() { if (busy) return; if (dirty) setConfirm('discard'); else onClose(); }
  async function save(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await onSave(draft, opportunity); onClose(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not save. Try again.'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!opportunity) return; setBusy(true); setConfirm(null); setError('');
    try { await onDelete(opportunity); onClose(); } catch (error) { setError(error instanceof Error ? error.message : 'Could not remove. Try again.'); } finally { setBusy(false); }
  }
  return <><Sheet open onOpenChange={open => { if (!open) close(); }}><SheetContent className="opportunity-sheet" showCloseButton>
    <SheetHeader className="editor-header"><div className="editor-eyebrow">{opportunity ? 'OPPORTUNITY DETAILS' : 'A NEW POSSIBILITY'}</div><div className="editor-heading">{draft.company ? <CompanyMark company={draft.company}/> : <span className="editor-icon"><Building2 size={21}/></span>}<SheetTitle>{opportunity ? opportunity.company : 'New opportunity'}</SheetTitle></div><SheetDescription>{opportunity ? 'Keep the details and the next step in one place.' : 'Start with a company. The rest can come later.'}</SheetDescription></SheetHeader>
    <form onSubmit={save} className="editor-form" aria-label="Opportunity details">
      <div className="editor-scroll"><fieldset disabled={busy}>
        <div className="field"><Label htmlFor="company">Company <span className="required-mark">*</span></Label><Input id="company" required maxLength={160} placeholder="Company name" value={draft.company} onChange={e => field('company',e.target.value)}/></div>
        <div className="field"><Label htmlFor="role">Role</Label><Input id="role" maxLength={200} placeholder="Job title" value={draft.role} onChange={e => field('role',e.target.value)}/></div>
        <div className="field-row"><div className="field"><Label htmlFor="stage">Stage</Label><NativeSelect id="stage" value={draft.stage} onChange={e => field('stage',e.target.value as StageId)}>{stages.map(stage => <NativeSelectOption key={stage.id} value={stage.id}>{stage.name}</NativeSelectOption>)}</NativeSelect></div><div className="field"><Label htmlFor="priority">Priority</Label><NativeSelect id="priority" value={draft.priority} onChange={e => field('priority',e.target.value as Draft['priority'])}><NativeSelectOption value="normal">Normal</NativeSelectOption><NativeSelectOption value="high">High priority</NativeSelectOption><NativeSelectOption value="low">Low priority</NativeSelectOption></NativeSelect></div></div>
        <div className="form-section-label">THE OPPORTUNITY</div>
        <div className="field"><Label htmlFor="url">Job or company link {draft.url.match(/^https?:\/\//) && <a href={draft.url} target="_blank" rel="noreferrer" className="field-link">Open link <ArrowUpRight size={12}/></a>}</Label><Input id="url" inputMode="url" maxLength={2000} placeholder="https://company.com/careers" value={draft.url} onBlur={() => { if (draft.url.trim() && !/^[a-z][a-z0-9+.-]*:/i.test(draft.url)) field('url','https://'+draft.url.trim()); }} onChange={e => field('url',e.target.value)}/></div>
        <div className="field-row"><div className="field"><Label htmlFor="location">Location / work setup</Label><Input id="location" maxLength={200} placeholder="Location and work arrangement" value={draft.location} onChange={e => field('location',e.target.value)}/></div><div className="field"><Label htmlFor="salary">Compensation</Label><Input id="salary" maxLength={160} placeholder="Amount, currency, and pay period" value={draft.salary} onChange={e => field('salary',e.target.value)}/></div></div>
        <div className="field-row"><div className="field"><Label htmlFor="contact">Contact name</Label><Input id="contact" maxLength={200} placeholder="Recruiter or hiring manager" value={draft.contact} onChange={e => field('contact',e.target.value)}/></div><div className="field"><Label htmlFor="contactEmail">Contact email</Label><Input id="contactEmail" type="email" maxLength={254} placeholder="name@company.com" value={draft.contactEmail} onChange={e => field('contactEmail',e.target.value)}/></div></div>
        <div className="form-section-label">KEEP THINGS MOVING</div>
        <div className="field"><Label htmlFor="nextStep">Next step</Label><Input id="nextStep" maxLength={500} placeholder="What would you like to do next?" value={draft.nextStep} onChange={e => field('nextStep',e.target.value)}/></div>
        <div className="field"><Label htmlFor="followUp">Follow-up date</Label><Input id="followUp" type="date" value={draft.followUp} onChange={e => field('followUp',e.target.value)}/></div>
        <div className="field"><Label htmlFor="notes">Notes</Label><Textarea id="notes" maxLength={20000} rows={5} placeholder="What interests you? Interview notes, people you met, questions to ask…" value={draft.notes} onChange={e => field('notes',e.target.value)}/></div>
      </fieldset>
      {opportunity && <Collapsible className="activity"><CollapsibleTrigger><Clock3 size={14}/>Activity history</CollapsibleTrigger><CollapsibleContent>{activityError ? <p>Activity could not be loaded. Reopen this opportunity to retry.</p> : activity.map((item,index) => <div className="activity-entry" key={`${item.createdAt}-${index}`}><span>{item.action === 'moved' ? `${(stages.find(s => s.id === item.fromStage) || stageInfo(item.fromStage || '')).name} → ${(stages.find(s => s.id === item.toStage) || stageInfo(item.toStage || '')).name}` : ({created:'Opportunity added',updated:'Details updated',deleted:'Opportunity removed',restored:'Opportunity restored'}[item.action] || item.action)}</span><time>{new Date(item.createdAt).toLocaleString(undefined,{ month:'short',day:'numeric',hour:'2-digit',minute:'2-digit' })}</time></div>)}</CollapsibleContent></Collapsible>}
      </div>
      <div className="editor-footer">{error && <div className="form-error" role="alert">{error}</div>}<div className="editor-actions">{opportunity && <AppButton type="button" className="delete-button" aria-label="Remove opportunity" onClick={() => setConfirm('delete')} disabled={busy}><Trash2 size={17}/></AppButton>}<AppButton type="button" className="secondary-button cancel-button" onClick={close} disabled={busy}>Cancel</AppButton><AppButton type="submit" className="primary-button" disabled={busy}><Check size={16}/>{busy ? 'Saving…' : opportunity ? 'Save changes' : 'Add opportunity'}</AppButton></div></div>
    </form>
  </SheetContent></Sheet>
  <AlertDialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{confirm === 'delete' ? `Remove ${opportunity?.company}?` : 'Discard your changes?'}</AlertDialogTitle><AlertDialogDescription>{confirm === 'delete' ? 'This opportunity will leave your pipeline. You can undo this immediately afterwards.' : 'The changes you made haven’t been saved.'}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep editing</AlertDialogCancel><AlertDialogAction onClick={() => { if (confirm === 'delete') void remove(); else onClose(); }}>{confirm === 'delete' ? 'Remove opportunity' : 'Discard changes'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </>;
}
