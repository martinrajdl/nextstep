import { readSearchProfile, readOnboarding, STAGES } from './store.mjs';

export function readContext(db, database, afterActivityId = 0) {
  if (!Number.isInteger(afterActivityId) || afterActivityId < 0) throw new Error('afterActivityId must be a nonnegative integer.');
  const records = db.prepare('SELECT * FROM opportunities ORDER BY position, created_at, id').all().map(row => ({...JSON.parse(row.data),id:row.id,stage:row.stage,position:row.position,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,removedAt:row.deleted_at}));
  const recentChanges = db.prepare('SELECT id, opportunity_id AS opportunityId, action, from_stage AS fromStage, to_stage AS toStage, created_at AS createdAt FROM activity WHERE id > ? ORDER BY id LIMIT 500').all(afterActivityId);
  const nextActivityCursor = recentChanges.at(-1)?.id ?? afterActivityId;
  const hasTable = name => Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const schedule = hasTable('agent_schedule') ? db.prepare('SELECT * FROM agent_schedule WHERE id=1').get() : null;
  const runs = hasTable('search_runs') ? db.prepare('SELECT * FROM search_runs ORDER BY created_at DESC, id DESC LIMIT 10').all().map(row => ({id:row.id,summary:row.summary,learning:row.learning,evidenceIds:JSON.parse(row.evidence_ids),importedIds:JSON.parse(row.imported_ids),createdAt:row.created_at})) : [];
  return {
    database,readAt:new Date().toISOString(),profile:readSearchProfile(db),
    byStage:Object.fromEntries(STAGES.map(stage => [stage,records.filter(job => job.stage === stage && !job.removedAt)])),
    removed:records.filter(job => job.removedAt),recentChanges,nextActivityCursor,
    hasMoreChanges:Boolean(db.prepare('SELECT 1 FROM activity WHERE id > ? LIMIT 1').get(nextActivityCursor)),
    schedule:schedule ? {...JSON.parse(schedule.data),version:schedule.version,updatedAt:schedule.updated_at} : null,
    recentSearches:runs,onboarding:readOnboarding(db),
    guidance:'Explicit preferences are authoritative. Interested is positive feedback. Uninterested is negative feedback within the role or company scope. Treat prior learning as tentative and re-evaluate it against current choices. Never modify app code or UI, application stages, existing notes or priorities during collection. Import only new verified Prospects.'
  };
}
