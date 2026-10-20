import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AppButton, { ButtonTooltip } from '@/components/app-button';
import { useEffect, useRef, useState } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ArrowRight, ArrowUp, ArrowDown, Archive, MoreHorizontal, RotateCcw, Settings2, Plus } from 'lucide-react';
import Modal from './crm/modal';

export type BoardSettings = { hiddenStages: string[]; actionStages: string[]; stageOrder?: string[]; stageNames?: Record<string, string> };
export type BoardStage = { id: string; name: string };
export function arrangeStages<T extends BoardStage>(stages: readonly T[], settings: BoardSettings): (Omit<T,'name'> & {name:string})[] {
  const order = [...new Set([...(settings.stageOrder || []), ...stages.map(s => s.id)])];
  return order.flatMap(id => { const stage=stages.find(s => s.id===id); return stage ? [{...stage, name:settings.stageNames?.[id]?.trim() || stage.name}] : []; });
}
const cache = new Map<string, BoardSettings>();
function valid(value: unknown): value is BoardSettings {
  const v = value as BoardSettings;
  return Boolean(v && Array.isArray(v.hiddenStages) && Array.isArray(v.actionStages) && [...v.hiddenStages, ...v.actionStages].every(s => typeof s === 'string') && (v.stageOrder === undefined || (Array.isArray(v.stageOrder) && v.stageOrder.every(s => typeof s === 'string'))) && (v.stageNames === undefined || (v.stageNames && typeof v.stageNames === 'object' && !Array.isArray(v.stageNames) && Object.values(v.stageNames).every(s => typeof s === 'string'))));
}
export function useBoardSettings(key: string, defaults: BoardSettings, importKey?: string) {
  const storageKey = `nextstep-board:${key}`;
  const [saved, setSaved] = useState<{key: string; value: BoardSettings} | null>(null);
  const [error, setError] = useState('');
  const editVersion = useRef(0);
  const defaultsKey = JSON.stringify(defaults);
  const value = saved?.key === storageKey ? saved.value : cache.get(storageKey) || defaults;
  useEffect(() => {
    let cancelled = false;
    const version = editVersion.current;
    const load = async () => {
      try {
        let result = window.nextstepDesktop
          ? await window.nextstepDesktop.getBoardSettings(key)
          : JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (!valid(result) && importKey) {
          const previous = window.nextstepDesktop ? await window.nextstepDesktop.getBoardSettings(importKey) : JSON.parse(localStorage.getItem(`nextstep-board:${importKey}`) || 'null');
          if (valid(previous)) {
            const initial = JSON.parse(defaultsKey) as BoardSettings;
            result = {...initial, ...previous, stageNames:{...initial.stageNames,...previous.stageNames}};
            if (window.nextstepDesktop) await window.nextstepDesktop.setBoardSettings(key, result);
            else localStorage.setItem(storageKey, JSON.stringify(result));
          }
        }
        if (!cancelled && version === editVersion.current && valid(result)) { cache.set(storageKey, result); setSaved({key: storageKey, value: result}); }
      } catch { /* A blocked preference store does not block access to records. */ }
    };
    void load();
    return () => { cancelled = true; };
  }, [key, storageKey, importKey, defaultsKey]);
  async function save(next: BoardSettings) {
    const previous = value;
    const version = ++editVersion.current;
    cache.set(storageKey, next);
    setSaved({key: storageKey, value: next});
    try {
      if (window.nextstepDesktop) await window.nextstepDesktop.setBoardSettings(key, next);
      else localStorage.setItem(storageKey, JSON.stringify(next));
      if (version === editVersion.current) setError('');
    } catch {
      if (version !== editVersion.current) return;
      cache.set(storageKey, previous);
      setSaved({key: storageKey, value: previous});
      setError('Could not save these view settings. Please try again.');
    }
  }
  return { settings: value, save, error };
}

export function BoardSettingsButton({ stages, settings, onChange, onAddStage, error = '' }: {
  stages: readonly BoardStage[]; settings: BoardSettings; onChange: (value: BoardSettings) => void; onAddStage?: (name:string) => Promise<void>; error?: string;
}) {
  const [open, setOpen] = useState(false);
  const [newStage, setNewStage] = useState('');
  const [adding, setAdding] = useState(false);
  const [stageError, setStageError] = useState('');
  const ordered = arrangeStages(stages, settings);
  const hidden = stages.filter(s => settings.hiddenStages.includes(s.id)).length;
  return <>
    <AppButton aria-label={hidden ? `View settings, ${hidden} hidden` : 'View settings'} className="crm-button board-settings-button" onClick={() => setOpen(true)}><Settings2 size={15}/>View settings{hidden > 0 && <span>{hidden} hidden</span>}</AppButton>
    {open && <Modal title="View settings" subtitle="Name and order your stages, choose what’s visible, and set quick actions." onClose={() => setOpen(false)}>
      <div className="crm-form-body board-settings-body">
        <fieldset><legend>Visible stages</legend><p>Hiding a stage keeps its records and history. All stages remain available in Actions.</p>
          {ordered.map((stage,index) => <div className="stage-settings-row" key={stage.id}>
            <Checkbox aria-label={`Show ${stage.name} stage`} checked={!settings.hiddenStages.includes(stage.id)} onCheckedChange={e => onChange({...settings, hiddenStages: e ? settings.hiddenStages.filter(s => s !== stage.id) : [...settings.hiddenStages, stage.id]})}/>
            <Input className="stage-name-input" aria-label={`Stage name for ${stage.name}`} defaultValue={stage.name} maxLength={80} onBlur={e => {
              const name=e.target.value.trim();
              if (name && name !== stage.name) onChange({...settings,stageNames:{...settings.stageNames,[stage.id]:name}});
              else e.target.value=stage.name;
            }}/>
            <AppButton className="crm-icon-button" aria-label={`Move ${stage.name} earlier`} disabled={index === 0} onClick={() => {const order=ordered.map(s => s.id);[order[index-1],order[index]]=[order[index],order[index-1]];onChange({...settings,stageOrder:order});}}><ArrowUp size={14}/></AppButton>
            <AppButton className="crm-icon-button" aria-label={`Move ${stage.name} later`} disabled={index === ordered.length-1} onClick={() => {const order=ordered.map(s => s.id);[order[index+1],order[index]]=[order[index],order[index+1]];onChange({...settings,stageOrder:order});}}><ArrowDown size={14}/></AppButton>
          </div>)}
          <AppButton className="crm-text-button" onClick={() => onChange({...settings, hiddenStages: []})}>Show all stages</AppButton>
          {onAddStage && <form className="add-stage-form" onSubmit={event => {
            event.preventDefault();if (!newStage.trim() || adding) return;
            setAdding(true);setStageError('');
            onAddStage(newStage.trim()).then(() => setNewStage('')).catch(e => setStageError(e instanceof Error ? e.message : 'Could not add stage.')).finally(() => setAdding(false));
          }}><Input aria-label="New stage name" placeholder="New stage…" maxLength={80} value={newStage} onChange={event => setNewStage(event.target.value)} disabled={adding}/><AppButton className="crm-icon-button" aria-label="Add stage" disabled={adding || !newStage.trim()}><Plus size={16}/></AppButton></form>}
          {stageError && <p className="crm-error" role="alert">{stageError}</p>}
        </fieldset>
        <fieldset><legend>Quick actions</legend><p>Choose up to three stages for the drag action bar.</p>
          {ordered.filter(s => s.id).map(stage => <Label key={stage.id}><Checkbox aria-label={`${stage.name} quick action`} checked={settings.actionStages.includes(stage.id)} disabled={!settings.actionStages.includes(stage.id) && settings.actionStages.length >= 3} onCheckedChange={e => onChange({...settings, actionStages: e ? [...settings.actionStages, stage.id] : settings.actionStages.filter(s => s !== stage.id)})}/>{stage.name}</Label>)}
        </fieldset>
        {error && <p className="crm-error" role="alert">{error}</p>}
      </div>
      <footer><AppButton className="crm-button" onClick={() => setOpen(false)}>Done</AppButton></footer>
    </Modal>}
  </>;
}

export function RecordActions({ title, stages, current, quickActions, disabled, onMove, onArchive, archived = false }: {
  title: string; stages: readonly BoardStage[]; current: string; quickActions: string[]; disabled?: boolean;
  onMove: (stage: string) => void; onArchive?: () => void; archived?: boolean;
}) {
  const quick = stages.filter(s => quickActions.includes(s.id) && s.id !== current);
  const remaining = stages.filter(s => !quick.some(q => q.id === s.id));
  return <DropdownMenu>
    <ButtonTooltip label="Actions"><DropdownMenuTrigger className="record-actions-trigger" aria-label={`Actions for ${title}`} disabled={disabled} onPointerDown={e => e.stopPropagation()} onDragStart={e => e.preventDefault()}><MoreHorizontal size={17}/></DropdownMenuTrigger></ButtonTooltip>
    <DropdownMenuContent align="end" sideOffset={6} className="record-actions-menu">
      {!archived && <><DropdownMenuGroup><DropdownMenuLabel>Quick actions</DropdownMenuLabel>{quick.map(s => <DropdownMenuItem key={s.id} onClick={() => onMove(s.id)}><ArrowRight size={14}/>{s.name}</DropdownMenuItem>)}{!quick.length && <DropdownMenuItem disabled>No quick actions for this stage</DropdownMenuItem>}</DropdownMenuGroup>
      <DropdownMenuGroup><DropdownMenuLabel>Move to stage</DropdownMenuLabel>{remaining.map(s => <DropdownMenuItem key={s.id} disabled={s.id === current} onClick={() => onMove(s.id)}>{s.name}{s.id === current && <small>Current</small>}</DropdownMenuItem>)}</DropdownMenuGroup></>}
      {onArchive && <DropdownMenuItem onClick={onArchive}>{archived ? <RotateCcw size={14}/> : <Archive size={14}/>} {archived ? 'Restore record' : 'Archive record'}</DropdownMenuItem>}
    </DropdownMenuContent>
  </DropdownMenu>;
}

export function BoardSkeleton({ table = false }: {table?: boolean}) {
  return <div className={`board-skeleton ${table ? 'is-table' : ''}`} aria-label="Loading records"><output className="sr-only">Loading records</output>{[0,1,2].map(i => <div key={i} aria-hidden="true"><i/><b/><b/></div>)}</div>;
}
