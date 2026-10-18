import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { openStore, AppError } from './store.mjs';
import { root, databasePath } from './config.mjs';
import { connectionConfig, setupInstructions, searchInstructions } from './agent-instructions.mjs';
import { checkBackend } from './backend.mjs';
export async function startServer({port = Number(process.env.PORT || 4317), database = databasePath(), dist = resolve(root,'dist'), agentCommand = {command:process.execPath,args:[resolve(root,'mcp/stdio.mjs')]}, crmAgentCommand = {command:process.execPath,args:[resolve(root,'mcp/crm-stdio.mjs')]}, developmentOrigins = [], backendUrl = null} = {}) {
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Choose a valid local port.');
const backend = backendUrl ? await checkBackend(backendUrl) : null;
const store = backend ? null : openStore(database);
const agentState = () => ({...store.agentStatus(),connection:connectionConfig({database,...agentCommand}),database});
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
async function body(req, limit = 65536) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use a JSON request.', 415);
  let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > limit) throw new AppError('This request is too large.', 413); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; } catch { throw new AppError('Invalid JSON request.'); }
}
const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  try {
    const activePort = server.address()?.port;
    const allowedHosts = new Set([`localhost:${activePort}`,`127.0.0.1:${activePort}`]);
    const allowedOrigins = new Set([`http://localhost:${activePort}`,`http://127.0.0.1:${activePort}`,...developmentOrigins]);
    if (!allowedHosts.has(req.headers.host)) throw new AppError('Only local access is allowed.', 403);
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) throw new AppError('Requests must come from this app.', 403);
    const path = new URL(req.url, `http://127.0.0.1:${activePort}`).pathname;
    if (path === '/api/health' && req.method === 'GET') return json(res, 200, { status: 'ok', app: 'nextstep', pid: process.pid, backend:backend ? 'self-hosted' : 'local' });
    if (backend && path.startsWith('/api/')) {
      if (!['GET','POST','PATCH','DELETE'].includes(req.method)) throw new AppError('Method not allowed.',405);
      const payload = req.method === 'GET' ? undefined : JSON.stringify(await body(req,524288));
      let upstream;
      try {
        const target = backend + path + new URL(req.url,'http://localhost').search;
        upstream = await fetch(target,{method:req.method,body:payload,headers:{'Content-Type':'application/json',Origin:backend},redirect:'error',signal:AbortSignal.timeout(15000)});
        if (!upstream.headers.get('content-type')?.includes('application/json')) throw new Error();
        const data = await upstream.json();
        if (upstream.headers.has('content-disposition')) res.setHeader('Content-Disposition',upstream.headers.get('content-disposition'));
        return json(res,upstream.status,data);
      } catch { throw new AppError('Your backend is unavailable. Check the server and SSH tunnel. Your local database has not been used as a fallback.',502); }
    }
    const crm = store?.crm;
    const params = new URL(req.url, 'http://localhost').searchParams;
    if (path === '/api/crm/flows' && req.method === 'GET') return json(res,200,{flows:crm.flows.list({limit:Number(params.get('limit') || 50),offset:Number(params.get('offset') || 0)})});
    if (path === '/api/crm/flows/report' && req.method === 'POST') return json(res,200,crm.flows.report(await body(req,262144)));
    if (path.startsWith('/api/crm/flows/') && req.method === 'GET') return json(res,200,crm.flows.get(decodeURIComponent(path.slice('/api/crm/flows/'.length))));
    if (path === '/api/crm/context' && req.method === 'GET') return json(res,200,{...crm.context(),existingWorkspaces:store.hasLegacyWorkspace() ? [{id:'legacy-board',name:'Job search',path:'/jobs'}] : [],connection:{mcpServers:{'nextstep-crm':{...crmAgentCommand,args:[...crmAgentCommand.args,'--database',database]}}}});
    if (path === '/api/crm/query' && req.method === 'POST') return json(res,200,crm.query(await body(req)));
    if (path === '/api/crm/preview' && req.method === 'POST') return json(res,200,crm.preview(await body(req,524288)));
    if (path === '/api/crm/proposals' && req.method === 'POST') return json(res,201,crm.propose(await body(req,524288)));
    if (path === '/api/crm/apply' && req.method === 'POST') return json(res,200,crm.apply({...await body(req,524288),actor:'You'}));
    if (path === '/api/crm/changes' && req.method === 'GET') return json(res,200,{changes:crm.changes({status:params.get('status') || undefined,limit:Number(params.get('limit') || 100),offset:Number(params.get('offset') || 0)})});
    if (path === '/api/crm/history' && req.method === 'GET') return json(res,200,{events:crm.history({entityId:params.get('entityId') || undefined,after:Number(params.get('after') || 0),limit:Number(params.get('limit') || 100)})});
    if (path === '/api/crm/export' && req.method === 'GET') { res.setHeader('Content-Disposition','attachment; filename="nextstep-workspace.json"'); return json(res,200,crm.export()); }
    if (path === '/api/crm/records/resolve' && req.method === 'POST') {
      const input = await body(req);
      if (!Array.isArray(input.ids) || input.ids.length > 200 || input.ids.some(id => typeof id !== 'string')) throw new AppError('Pass up to 200 record IDs.');
      return json(res,200,{records:input.ids.map(id => crm.getRecord(id))});
    }
    const crmRecord = path.match(/^\/api\/crm\/records\/([a-f0-9-]{36})$/);
    if (crmRecord && req.method === 'GET') return json(res,200,{record:crm.getRecord(crmRecord[1])});
    const crmChange = path.match(/^\/api\/crm\/changes\/([^/]+)(?:\/(review))?$/);
    if (crmChange && req.method === 'GET' && !crmChange[2]) return json(res,200,crm.getChange(decodeURIComponent(crmChange[1])));
    if (crmChange?.[2] && req.method === 'POST') return json(res,200,crm.review(decodeURIComponent(crmChange[1]),await body(req)));
    if (path === '/api/agent' && req.method === 'GET') return json(res,200,agentState());
    if (path === '/api/agent/setup' && req.method === 'GET') return json(res,200,{instructions:setupInstructions(store.agentStatus().schedule,store.agentStatus().onboarding,database)});
    if (path === '/api/agent/search' && req.method === 'GET') return json(res,200,{instructions:searchInstructions(database)});
    if (path === '/api/onboarding' && req.method === 'PATCH') { store.updateOnboarding(await body(req)); return json(res,200,agentState()); }
    if (path === '/api/agent/schedule' && req.method === 'PATCH') { store.updateSchedule(await body(req)); return json(res,200,agentState()); }
    if (path === '/api/agent/schedule' && req.method === 'DELETE') { store.forgetSchedule(await body(req)); return json(res,200,agentState()); }
    if (path === '/api/profile' && req.method === 'GET') return json(res, 200, { profile: store.getProfile() });
    if (path === '/api/profile' && req.method === 'PATCH') return json(res, 200, { profile: store.updateProfile(await body(req)) });
    if (path === '/api/opportunities' && req.method === 'GET') return json(res, 200, { opportunities: store.list() });
    if (path === '/api/opportunities' && req.method === 'POST') { const opportunity = store.create(await body(req)); return json(res, 201, { opportunity, opportunities: store.list() }); }
    if (path === '/api/export' && req.method === 'GET') {
      res.setHeader('Content-Disposition', 'attachment; filename="nextstep-backup.json"');
      return json(res, 200, { format: 'nextstep', version: 3, exportedAt: new Date().toISOString(), profile: store.getProfile(), agent:store.agentStatus(), opportunities: store.list() });
    }
    const match = path.match(/^\/api\/opportunities\/([a-f0-9-]{36})(?:\/(move|activity|restore))?$/);
    if (match) {
      const [, id, action] = match;
      if (action === 'activity' && req.method === 'GET') return json(res, 200, { activity: store.activity(id) });
      if (!action && req.method === 'PATCH') { const opportunity = store.update(id, await body(req)); return json(res, 200, { opportunity, opportunities: store.list() }); }
      if (action === 'move' && req.method === 'POST') { const opportunity = store.move(id, await body(req)); return json(res, 200, { opportunity, opportunities: store.list() }); }
      if (action === 'restore' && req.method === 'POST') { await body(req); const opportunity = store.restore(id); return json(res, 200, { opportunity, opportunities: store.list() }); }
      if (!action && req.method === 'DELETE') { store.remove(id, await body(req)); return json(res, 200, { opportunities: store.list() }); }
    }
    if (path.startsWith('/api/')) throw new AppError('Endpoint not found.', 404);
    if (!['GET', 'HEAD'].includes(req.method)) throw new AppError('Method not allowed.', 405);
    const local = resolve(dist, '.' + decodeURIComponent(['/', '/jobs'].includes(path) ? '/index.html' : path));
    if (!local.startsWith(dist + sep)) throw new AppError('Not found.', 404);
    let content; try { if (!(await stat(local)).isFile()) throw new Error(); content = await readFile(local); } catch { throw new AppError('Build the app first with pnpm build.', 404); }
    res.writeHead(200, { 'Content-Type': mime[extname(local)] || 'application/octet-stream', 'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch (error) {
    if (!(error instanceof AppError)) console.error(error);
    if (!res.headersSent) json(res, error.status || 500, { error: error instanceof AppError ? error.message : 'Could not save your changes. Please try again.' });
    else res.end();
  }
});
await new Promise((resolve,reject) => {
  server.once('error',reject);
  server.listen(port,'127.0.0.1',resolve);
}).catch(error => { store?.close(); throw error; });
let closing;
return {server,store,database:backend ? null : database,backendUrl:backend,url:`http://127.0.0.1:${server.address().port}`,close() {
  if (!closing) closing = new Promise((resolve,reject) => {
    server.close(error => { store?.close(); error ? reject(error) : resolve(); });
    server.closeIdleConnections();
  });
  return closing;
}};
}
