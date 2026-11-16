import { AppError } from '../errors.mjs';

export function workspaceOperation(method, path, params, input, identity, origin) {
  const actor = identity.kind === 'agent' ? `Agent: ${identity.label} (${identity.id})`.slice(0,120) : identity.email || identity.id;
  const read = (run) => ({ write: false, run });
  const write = (action, run, owner = false) => ({ write: true, owner, action, changeId: input?.id ?? input?.changeId ?? null, run });
  const change = () => ({ ...input, actor });
  const human = () => { if (identity.kind === 'agent') throw new AppError('A signed-in person must review this action.', 403); };
  const pagination = () => ({ limit: Number(params.get('limit') || 100), offset: Number(params.get('offset') || 0) });
  if (path === '/api/crm/context' && method === 'GET') return read(({ crm, workspace, member }) => ({
    ...crm.context(),
    compatibilityCollectionId: null,
    connection: { mcpServers: { 'nextstep-crm': {
      command: 'node', args: ['/path/to/nextstep/mcp/crm-stdio.mjs','--server',origin,'--workspace',workspace.id,'--credential-file','/private/path/nextstep-agent-token'],
    } } },
    hosted: { workspaceId: workspace.id, workspaceName: workspace.name, role: member.role, origin },
  }));
  if (path === '/api/crm/policy' && method === 'GET') return read(({ crm }) => crm.policy());
  if (path === '/api/crm/policy' && method === 'PATCH') { human(); return write('update_review_policy', ({ crm }) => crm.setPolicy(input), true); }
  if (path === '/api/crm/query' && method === 'POST') return read(({ crm }) => crm.query(input));
  if (path === '/api/crm/preview' && method === 'POST') return read(({ crm }) => crm.preview(change()));
  if (path === '/api/crm/proposals' && method === 'POST') return write('propose', ({ crm }) => crm.propose(change()));
  if (path === '/api/crm/apply' && method === 'POST') return write('apply', ({ crm }) => identity.kind === 'agent' ? crm.agentApply(change()) : crm.apply(change()));
  if (path === '/api/crm/changes' && method === 'GET') return read(({ crm }) => ({ changes: crm.changes({ status: params.get('status') || undefined, ...pagination() }) }));
  if (path === '/api/crm/history' && method === 'GET') return read(({ crm }) => ({ events: crm.history({ entityId: params.get('entityId') || undefined, after: Number(params.get('after') || 0), limit: Number(params.get('limit') || 100) }) }));
  if (path === '/api/crm/export' && method === 'GET') return read(({ crm }) => crm.export());
  if (path === '/api/crm/records/resolve' && method === 'POST') {
    if (!Array.isArray(input.ids) || input.ids.length > 200 || input.ids.some((id) => typeof id !== 'string')) throw new AppError('Pass up to 200 record IDs.');
    return read(({ crm }) => ({ records: input.ids.map((id) => crm.getRecord(id)) }));
  }
  const record = path.match(/^\/api\/crm\/records\/([a-zA-Z0-9_-]{1,120})$/);
  if (record && method === 'GET') return read(({ crm }) => ({ record: crm.getRecord(record[1]) }));
  const collection = path.match(/^\/api\/crm\/collections\/([a-z][a-z0-9_]{0,63})$/);
  if (collection && method === 'GET') return read(({ crm }) => ({ collection: crm.getCollection(collection[1]) }));
  const proposal = path.match(/^\/api\/crm\/changes\/([^/]+)(?:\/(review))?$/);
  if (proposal && !proposal[2] && method === 'GET') return read(({ crm }) => crm.getChange(decodeURIComponent(proposal[1])));
  if (proposal?.[2] && method === 'POST') { human(); return write('review', ({ crm }) => crm.review(decodeURIComponent(proposal[1]), input)); }
  if (path === '/api/crm/flows' && method === 'GET') return read(({ crm }) => ({ flows: crm.flows.list({ ...pagination(), limit: Number(params.get('limit') || 50) }) }));
  if (path === '/api/crm/flows/report' && method === 'POST') return write('report_flow', ({ crm }) => crm.flows.report(change()));
  if (path.startsWith('/api/crm/flows/') && method === 'GET') return read(({ crm }) => crm.flows.get(decodeURIComponent(path.slice('/api/crm/flows/'.length))));
  if (path === '/api/notes' && method === 'GET') return read(({ crm }) => crm.notes.list({ search: params.get('search') || '', tag: params.get('tag') || '', state: params.get('state') || 'active', linkedTo: params.get('linkedTo') || '', ...pagination() }));
  if (path === '/api/notes/sync' && method === 'GET') return read(() => ({ available: false, enabled: false, folder: null, lastSyncedAt: null, message: '', state: 'unavailable', pending: 0, missingCount: 0 }));
  const note = path.match(/^\/api\/notes\/([a-fA-F0-9-]{36})$/);
  if (note && method === 'GET') return read(({ crm }) => crm.notes.get(note[1]));
  throw new AppError('Endpoint not found.', 404);
}
