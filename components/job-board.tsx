import AppButton from '@/components/app-button';
import { useState, type CSSProperties } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical, MapPin, Plus, Star } from 'lucide-react';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { RecordActions } from './board-controls';
import { companyColor, dateLabel, initials, STAGES, today, type Opportunity, type PipelineStage, type StageId } from '@/lib/model';

type Props = { actionStages: string[]; allStages: PipelineStage[]; jobs: Opportunity[]; allJobs: Opportunity[]; stages: PipelineStage[]; busy: boolean; filtered: boolean; onOpen: (job: Opportunity) => void; onAdd: (stage: StageId) => void; onMove: (job: Opportunity, stage: StageId, beforeId: string | null) => void };
const actionDropId = (stage: string) => `action:${stage}`;
const isAction = (id: unknown) => typeof id === 'string' && id.startsWith('action:');
const dragInstructions = 'To pick up a card, press Space. Use the arrow keys to move it. Press Arrow Down after the last card to reach quick actions, then Left or Right to choose one. Press Space to drop, or Escape to cancel.';
export function CompanyMark({ company, small = false }: { company: string; small?: boolean }) {
  const color = companyColor(company);
  return <span className={`company-mark ${small ? 'small' : ''}`} style={{ '--company-color':color } as CSSProperties}>{initials(company)}</span>;
}
function CardContent({ job }: { job: Opportunity }) {
  return <><div className="card-company"><CompanyMark company={job.company}/><span>{job.company}</span>{job.priority === 'high' && <Star size={13} className="priority-star" fill="currentColor"/>}</div><div className={`card-role ${job.role ? '' : 'no-role'}`}>{job.role || 'Role to explore'}</div>{job.location && <div className="card-location"><MapPin size={12}/>{job.location}</div>}{job.nextStep && <div className="card-next-step">{job.nextStep}</div>}{(job.followUp || job.salary) && <div className="card-bottom">{job.followUp && <span className={`due-date ${job.followUp < today() ? 'overdue' : job.followUp === today() ? 'due-today' : ''}`}><CalendarDays size={12}/>{dateLabel(job.followUp)}{job.followUp < today() ? ' · overdue' : ''}</span>}{job.salary && <span className="card-salary">{job.salary}</span>}</div>}</>;
}
function JobCard({ job, busy, onOpen, onMove, actionStages, allStages }: { job: Opportunity } & Pick<Props,'busy'|'onOpen'|'onMove'|'actionStages'|'allStages'>) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id, data: { stage: job.stage }, disabled: busy });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .25 : 1 };
  return <article ref={setNodeRef} style={style} className="job-card" data-job-id={job.id} {...listeners}>
    <AppButton className="card-open" aria-label={`Open ${job.company}`} onClick={() => onOpen(job)}><CardContent job={job}/></AppButton>
    <RecordActions title={job.company} stages={allStages} current={job.stage} quickActions={actionStages} disabled={busy} onMove={stage => onMove(job,stage as StageId,null)}/>
    <AppButton {...attributes} {...listeners} className="drag-handle" aria-label={`Move ${job.company}`} title="Drag to move. Or use Space, arrow keys, then Space." style={{ touchAction: 'none' }}><GripVertical size={16}/></AppButton>
  </article>;
}
function Column({ stage, jobs, busy, filtered, onAdd, onOpen, onMove, actionStages, allStages }: { stage: PipelineStage; jobs: Opportunity[] } & Pick<Props,'busy'|'filtered'|'onAdd'|'onOpen'|'onMove'|'actionStages'|'allStages'>) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage: stage.id } });
  return <section className="board-column" aria-label={`${stage.name} stage`}><div className="column-heading"><span className="stage-dot" style={{ background: stage.color }}/><h2>{stage.name}</h2><span className="column-count">{jobs.length}</span><AppButton className="icon-button" aria-label={`Add to ${stage.name}`} onClick={() => onAdd(stage.id)}><Plus size={17}/></AppButton></div><div ref={setNodeRef} className={`column-body ${isOver ? 'drop-over' : ''}`} data-stage={stage.id}>
    <SortableContext items={jobs.map(job => job.id)} strategy={verticalListSortingStrategy}>{jobs.map(job => <JobCard key={job.id} job={job} busy={busy} onOpen={onOpen} onMove={onMove} actionStages={actionStages} allStages={allStages}/>)}</SortableContext>
    {jobs.length === 0 && <Empty className="column-empty"><span className="empty-stage-number">0{allStages.findIndex(s => s.id===stage.id)+1}</span><EmptyTitle>{filtered ? 'No matches here' : 'No opportunities yet'}</EmptyTitle><EmptyDescription>{stage.hint}</EmptyDescription></Empty>}
    <AppButton className="add-card" onClick={() => onAdd(stage.id)}><Plus size={15}/>Add opportunity</AppButton>
  </div></section>;
}
function ActionDropTarget({ stage }: { stage: PipelineStage }) {
  const { setNodeRef, isOver } = useDroppable({ id: actionDropId(stage.id), data: { stage: stage.id } });
  return <section ref={setNodeRef} aria-label={`${stage.name} drop target`} className={`board-action-target ${isOver ? 'drop-over' : ''}`}><span className="stage-dot" style={{background:stage.color}}/><strong>{stage.name}</strong><small>{isOver ? 'Release to move' : stage.closed ? 'Move to Closed' : 'Move to stage'}</small></section>;
}
const collision: CollisionDetection = args => {
  const pointerCoordinates = args.pointerCoordinates || { x: args.collisionRect.left + args.collisionRect.width / 2, y: args.collisionRect.top + args.collisionRect.height / 2 };
  const hits = pointerWithin({ ...args, pointerCoordinates });
  const actionHit = hits.find(hit => isAction(hit.id));
  if (actionHit) return [actionHit];
  const cardHits = hits.filter(hit => !STAGES.some(stage => stage.id === hit.id));
  // A missed drop must never activate an action just because it is nearby.
  return cardHits.length ? cardHits : hits.length ? hits : closestCorners({ ...args, droppableContainers: args.droppableContainers.filter(item => !isAction(item.id)) });
};
const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const { active, over, droppableContainers, droppableRects, collisionRect } = context;
  if (!active) return;
  if (isAction(over?.id)) {
    const actions = droppableContainers.getEnabled().filter(item => isAction(item.id));
    const index = actions.findIndex(item => item.id === over?.id);
    const next = actions[index + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = event.code === 'ArrowUp' ? droppableRects.get(active.id) : ['ArrowLeft','ArrowRight'].includes(event.code) && next ? droppableRects.get(next.id) : null;
    if (rect && collisionRect) return { x: rect.left + (rect.width - collisionRect.width) / 2, y: rect.top + (rect.height - collisionRect.height) / 2 };
    return;
  }
  const current = droppableContainers.get(over?.id || active.id);
  const stage = current?.data.current?.stage || active.data.current?.stage;
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    const columns = STAGES.filter(item => droppableContainers.has(item.id)).sort((a,b) => (droppableRects.get(a.id)?.left || 0) - (droppableRects.get(b.id)?.left || 0));
    const index = columns.findIndex(item => item.id === stage);
    const next = columns[index + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = next && droppableRects.get(next.id);
    if (rect) return { x: rect.left + 10, y: rect.top + 10 };
  } else {
    const cards = droppableContainers.getEnabled().filter(item => !isAction(item.id) && item.data.current?.stage === stage && !STAGES.some(stage => stage.id === item.id)).sort((a,b) => (droppableRects.get(a.id)?.top || 0) - (droppableRects.get(b.id)?.top || 0));
    const index = cards.findIndex(item => item.id === (over?.id || active.id));
    const next = cards[index < 0 ? (event.code === 'ArrowDown' ? 0 : cards.length-1) : index + (event.code === 'ArrowDown' ? 1 : -1)];
    const rect = next && droppableRects.get(next.id);
    if (rect) return { x: rect.left, y: rect.top };
    const firstAction = droppableContainers.getEnabled().find(item => isAction(item.id));
    const rejected = firstAction && droppableRects.get(firstAction.id);
    if (event.code === 'ArrowDown' && !next && rejected && collisionRect) return { x: rejected.left + (rejected.width - collisionRect.width) / 2, y: rejected.top + (rejected.height - collisionRect.height) / 2 };
  }
};
export default function JobBoard({ actionStages, allStages, jobs, allJobs, stages, busy, filtered, onOpen, onAdd, onMove }: Props) {
  const [active, setActive] = useState<Opportunity | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }));
  function end({ active: dragged, over }: DragEndEvent) {
    setActive(null);
    if (!over || dragged.id === over.id) return;
    const job = allJobs.find(item => item.id === dragged.id); if (!job) return;
    const targetJob = allJobs.find(item => item.id === over.id);
    const stage = isAction(over.id) ? STAGES.find(s => actionDropId(s.id) === over.id)?.id : targetJob?.stage || STAGES.find(stage => stage.id === over.id)?.id;
    if (!stage) return;
    const targetJobs = allJobs.filter(item => item.stage === stage && item.id !== job.id);
    let beforeId: string | null = null;
    if (targetJob) {
      const overIndex = targetJobs.findIndex(item => item.id === targetJob.id);
      const movingDown = job.stage === stage && job.position < targetJob.position;
      const below = job.stage !== stage && dragged.rect.current.translated && dragged.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      beforeId = movingDown || below ? targetJobs[overIndex+1]?.id || null : targetJob.id;
    }
    onMove(job, stage, beforeId);
  }
  const actions = active ? actionStages.map(id => allStages.find(s => s.id === id)).filter((s): s is PipelineStage => Boolean(s && s.id !== active.stage)) : [];
  return <DndContext sensors={sensors} collisionDetection={collision} accessibility={{ screenReaderInstructions: { draggable: dragInstructions } }} onDragStart={({ active }) => setActive(allJobs.find(job => job.id === active.id) || null)} onDragCancel={() => setActive(null)} onDragEnd={end}><div className="board" aria-label="Opportunity board">{stages.map(stage => <Column key={stage.id} stage={stage} jobs={jobs.filter(job => job.stage === stage.id)} busy={busy} filtered={filtered} onAdd={onAdd} onOpen={onOpen} onMove={onMove} actionStages={actionStages} allStages={allStages}/>)}</div><div className="board-action-dock" aria-label="Drag actions">{actions.map(stage => <ActionDropTarget key={stage.id} stage={stage}/>)}</div><DragOverlay dropAnimation={null} style={{pointerEvents:'none'}}>{active && <div className="job-card drag-preview"><CardContent job={active}/></div>}</DragOverlay></DndContext>;
}
