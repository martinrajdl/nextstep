import { createHash } from 'node:crypto';
import { AppError } from './errors.mjs';

export const FLOW_STAGES = [
  'sourcing',
  'shaping',
  'review',
  'updating',
  'complete',
  'blocked',
];
const fail = (message, status = 400) => {
  throw new AppError(message, status);
};
const text = (value, label, max = 200) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail(`${label} must be non-empty text of at most ${max} characters.`);
  return value.trim();
};
export function createFlowStore(db, transaction, getChange) {
  function hydrate(row) {
    if (!row) fail('Agent flow not found.', 404);
    const data = JSON.parse(row.data);
    const changes = data.changeIds.map((id) => {
      const change = getChange(id);
      return {
        id: change.id,
        title: change.title,
        status: change.status,
        operationCount: change.operations.length,
      };
    });
    return {
      ...data,
      id: row.id,
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      changes,
      pendingCount: changes.filter((c) => c.status === 'pending').length,
      appliedCount: changes
        .filter((c) => ['approved', 'applied'].includes(c.status))
        .reduce((sum, c) => sum + c.operationCount, 0),
    };
  }
  const get = (id) =>
    hydrate(
      db
        .prepare('SELECT * FROM crm_flows WHERE id=?')
        .get(text(id, 'Flow ID', 120)),
    );
  const updates = (id) =>
    db
      .prepare(
        'SELECT report_id,data,created_at FROM crm_flow_updates WHERE flow_id=? ORDER BY id DESC LIMIT 100',
      )
      .all(id)
      .map((row) => ({
        ...JSON.parse(row.data),
        reportId: row.report_id,
        createdAt: row.created_at,
      }));
  function list({ limit = 50, offset = 0 } = {}) {
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 100 ||
      !Number.isInteger(offset) ||
      offset < 0
    )
      fail('Invalid flow pagination.');
    return db
      .prepare(
        'SELECT * FROM crm_flows ORDER BY updated_at DESC,id LIMIT ? OFFSET ?',
      )
      .all(limit, offset)
      .map(hydrate);
  }
  function report(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      fail('Pass an agent flow report.');
    const allowed = [
      'id',
      'reportId',
      'version',
      'goal',
      'actor',
      'stage',
      'message',
      'changeIds',
      'sources',
    ];
    if (Object.keys(input).some((k) => !allowed.includes(k)))
      fail('Unknown agent flow report field.');
    const id = text(input.id, 'Flow ID', 120),
      reportId = text(input.reportId, 'Report ID', 120);
    if (!FLOW_STAGES.includes(input.stage))
      fail('Choose a valid agent flow stage.');
    const message = text(input.message, 'Progress message', 2000);
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(allowed.map((key) => [key, input[key] ?? null])))
      .digest('hex');
    return transaction(() => {
      const replay = db
        .prepare(
          'SELECT fingerprint FROM crm_flow_updates WHERE flow_id=? AND report_id=?',
        )
        .get(id, reportId);
      if (replay) {
        if (replay.fingerprint !== fingerprint)
          fail('This report ID was already used for different content.', 409);
        return { ...get(id), replayed: true };
      }
      const existing = db.prepare('SELECT * FROM crm_flows WHERE id=?').get(id);
      if (
        !Number.isInteger(input.version) ||
        input.version !== (existing?.version ?? 0)
      )
        fail(
          'This flow changed. Read its current version before reporting progress.',
          409,
        );
      const previous = existing
        ? JSON.parse(existing.data)
        : { changeIds: [], sources: [] };
      const goal = text(input.goal ?? previous.goal, 'Flow goal', 300);
      const actor = text(
        input.actor ?? previous.actor ?? 'Agent',
        'Agent name',
        120,
      );
      if (
        input.changeIds !== undefined &&
        (!Array.isArray(input.changeIds) || input.changeIds.length > 100)
      )
        fail('Link up to 100 change sets per report.');
      const changeIds = [
        ...new Set([
          ...previous.changeIds,
          ...(input.changeIds ?? []).map((value) =>
            text(value, 'Change ID', 120),
          ),
        ]),
      ];
      if (changeIds.length > 200)
        fail('A flow can link up to 200 change sets.');
      const changes = changeIds.map(getChange);
      if (
        input.stage === 'review' &&
        !changes.some((c) => c.status === 'pending')
      )
        fail('Link a pending proposal before reporting the review stage.');
      if (
        input.stage === 'complete' &&
        changes.some((c) => !['approved', 'applied'].includes(c.status))
      )
        fail(
          'Resolve pending or rejected changes before marking this flow complete. Use blocked when a decision prevents completion.',
        );
      if (
        input.sources !== undefined &&
        (!Array.isArray(input.sources) || input.sources.length > 50)
      )
        fail('Report up to 50 source links at a time.');
      const sources = (input.sources ?? []).map((source) => {
        const label = text(source?.label, 'Source label', 200),
          url = text(source?.url, 'Source URL', 2000);
        let parsed;
        try {
          parsed = new URL(url);
        } catch {
          fail('Use a valid source URL.');
        }
        if (
          !['https:', 'http:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          fail('Use an HTTP or HTTPS source URL without credentials.');
        return { label, url: parsed.href };
      });
      const allSources = [
        ...new Map(
          [...previous.sources, ...sources].map((source) => [
            source.url,
            source,
          ]),
        ).values(),
      ];
      if (allSources.length > 200)
        fail('A flow can record up to 200 source links.');
      const data = {
        goal,
        actor,
        stage: input.stage,
        message,
        changeIds,
        sources: allSources,
      };
      const now = new Date().toISOString();
      if (existing)
        db.prepare(
          'UPDATE crm_flows SET data=?,version=version+1,updated_at=? WHERE id=?',
        ).run(JSON.stringify(data), now, id);
      else
        db.prepare('INSERT INTO crm_flows VALUES (?,?,1,?,?)').run(
          id,
          JSON.stringify(data),
          now,
          now,
        );
      db.prepare(
        'INSERT INTO crm_flow_updates(flow_id,report_id,fingerprint,data,created_at) VALUES (?,?,?,?,?)',
      ).run(
        id,
        reportId,
        fingerprint,
        JSON.stringify({
          stage: input.stage,
          message,
          actor,
          changeIds: input.changeIds ?? [],
          sources,
        }),
        now,
      );
      return get(id);
    });
  }
  return {
    get: (id) => ({ ...get(id), updates: updates(id) }),
    list,
    report,
    export: () => ({
      flows: db
        .prepare('SELECT * FROM crm_flows ORDER BY created_at,id')
        .all()
        .map(hydrate),
      updates: db
        .prepare(
          'SELECT flow_id,report_id,data,created_at FROM crm_flow_updates ORDER BY id',
        )
        .all()
        .map((row) => ({
          flowId: row.flow_id,
          reportId: row.report_id,
          ...JSON.parse(row.data),
          createdAt: row.created_at,
        })),
    }),
  };
}
