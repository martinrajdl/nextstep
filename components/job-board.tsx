import { useState, type CSSProperties } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, closestCorners, pointerWithin, useDroppable, useSensor, useSensors, type DragEndEvent, type CollisionDetection, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GripVertical, MapPin, Plus, Star } from 'lucide-react';
import { Empty, EmptyDescription, EmptyTitle } from '@/components/ui/empty';
import { companyColor, dateLabel, initials, STAGES, today, type Opportunity, type StageId } from '@/lib/model';

type Props = { jobs: Opportunity[]; allJobs: Opportunity[]; stages: typeof STAGES[number][]; busy: boolean; filtered: boolean; onOpen: (job: Opportunity) => void; onAdd: (stage: StageId) => void; onMove: (job: Opportunity, stage: StageId, beforeId: string | null) => void };
export function CompanyMark({ company, small = false }: { company: string; small?: boolean }) {
  const color = companyColor(company);
  return <span className={`company-mark ${small ? 'small' : ''}`} style={{ color, background: `${color}15` }}>{initials(company)}</span>;
}
function CardContent({ job }: { job: Opportunity }) {
  return <><div className="card-company"><CompanyMark company={job.company}/><span>{job.company}</span>{job.priority === 'high' && <Star size={13} className="priority-star" fill="currentColor"/>}</div><div className={`card-role ${job.role ? '' : 'no-role'}`}>{job.role || 'Role to explore'}</div>{job.location && <div className="card-location"><MapPin size={12}/>{job.location}</div>}{job.nextStep && <div className="card-next-step">{job.nextStep}</div>}{(job.followUp || job.salary) && <div className="card-bottom">{job.followUp && <span className={`due-date ${job.followUp < today() ? 'overdue' : job.followUp === today() ? 'due-today' : ''}`}><CalendarDays size={12}/>{dateLabel(job.followUp)}{job.followUp < today() ? ' · overdue' : ''}</span>}{job.salary && <span className="card-salary">{job.salary}</span>}</div>}</>;
}
function JobCard({ job, busy, onOpen }: { job: Opportunity; busy: boolean; onOpen: Props['onOpen'] }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: job.id, data: { stage: job.stage }, disabled: busy });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? .25 : 1 };
  return <article ref={setNodeRef} style={style} className="job-card" data-job-id={job.id} {...listeners}>
    <button className="card-open" aria-label={`Open ${job.company}`} onClick={() => onOpen(job)}><CardContent job={job}/></button>
    <button {...attributes} {...listeners} className="drag-handle" aria-label={`Move ${job.company}`} title="Drag to move. Or use Space, arrow keys, then Space." style={{ touchAction: 'none' }}><GripVertical size={16}/></button>
  </article>;
}
function Column({ stage, jobs, busy, filtered, onAdd, onOpen }: { stage: typeof STAGES[number]; jobs: Opportunity[] } & Pick<Props,'busy'|'filtered'|'onAdd'|'onOpen'>) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id, data: { stage: stage.id } });
  return <section className="board-column" aria-label={`${stage.name} stage`}><div className="column-heading"><span className="stage-dot" style={{ background: stage.color }}/><h2>{stage.name}</h2><span className="column-count">{jobs.length}</span><button className="icon-button" aria-label={`Add to ${stage.name}`} onClick={() => onAdd(stage.id)}><Plus size={17}/></button></div><div ref={setNodeRef} className={`column-body ${isOver ? 'drop-over' : ''}`} data-stage={stage.id}>
    <SortableContext items={jobs.map(job => job.id)} strategy={verticalListSortingStrategy}>{jobs.map(job => <JobCard key={job.id} job={job} busy={busy} onOpen={onOpen}/>)}</SortableContext>
    {jobs.length === 0 && <Empty className="column-empty"><span className="empty-stage-number">0{STAGES.indexOf(stage)+1}</span><EmptyTitle>{filtered ? 'No matches here' : 'No opportunities yet'}</EmptyTitle><EmptyDescription>{stage.hint}</EmptyDescription></Empty>}
    <button className="add-card" onClick={() => onAdd(stage.id)}><Plus size={15}/>Add opportunity</button>
  </div></section>;
}
const collision: CollisionDetection = args => {
  const pointerCoordinates = args.pointerCoordinates || { x: args.collisionRect.left + args.collisionRect.width / 2, y: args.collisionRect.top + args.collisionRect.height / 2 };
  const hits = pointerWithin({ ...args, pointerCoordinates });
  const cardHits = hits.filter(hit => !STAGES.some(stage => stage.id === hit.id));
  return cardHits.length ? cardHits : hits.length ? hits : closestCorners(args);
};
const keyboardCoordinates: KeyboardCoordinateGetter = (event, { context }) => {
  if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.code)) return;
  event.preventDefault();
  const { active, over, droppableContainers, droppableRects } = context;
  if (!active) return;
  const current = droppableContainers.get(over?.id || active.id);
  const stage = current?.data.current?.stage || active.data.current?.stage;
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    const columns = STAGES.filter(item => droppableContainers.has(item.id));
    const index = columns.findIndex(item => item.id === stage);
    const next = columns[index + (event.code === 'ArrowRight' ? 1 : -1)];
    const rect = next && droppableRects.get(next.id);
    if (rect) return { x: rect.left + 10, y: rect.top + 10 };
  } else {
    const cards = droppableContainers.getEnabled().filter(item => item.data.current?.stage === stage && !STAGES.some(stage => stage.id === item.id)).sort((a,b) => (droppableRects.get(a.id)?.top || 0) - (droppableRects.get(b.id)?.top || 0));
    const index = cards.findIndex(item => item.id === (over?.id || active.id));
    const next = cards[index < 0 ? (event.code === 'ArrowDown' ? 0 : cards.length-1) : index + (event.code === 'ArrowDown' ? 1 : -1)];
    const rect = next && droppableRects.get(next.id);
    if (rect) return { x: rect.left, y: rect.top };
  }
};
export default function JobBoard({ jobs, allJobs, stages, busy, filtered, onOpen, onAdd, onMove }: Props) {
  const [active, setActive] = useState<Opportunity | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }));
  function end({ active: dragged, over }: DragEndEvent) {
    setActive(null);
    if (!over || dragged.id === over.id) return;
    const job = allJobs.find(item => item.id === dragged.id); if (!job) return;
    const targetJob = allJobs.find(item => item.id === over.id);
    const stage = targetJob?.stage || STAGES.find(stage => stage.id === over.id)?.id;
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
  return <DndContext sensors={sensors} collisionDetection={collision} onDragStart={({ active }) => setActive(allJobs.find(job => job.id === active.id) || null)} onDragCancel={() => setActive(null)} onDragEnd={end}><div className="board" aria-label="Opportunity board">{stages.map(stage => <Column key={stage.id} stage={stage} jobs={jobs.filter(job => job.stage === stage.id)} busy={busy} filtered={filtered} onAdd={onAdd} onOpen={onOpen}/>)}</div><DragOverlay dropAnimation={null} style={{pointerEvents:'none'}}>{active && <div className="job-card drag-preview"><CardContent job={active}/></div>}</DragOverlay></DndContext>;
}
