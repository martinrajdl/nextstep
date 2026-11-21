import { AppError } from '../errors.mjs';
import { hostedAuth } from './auth.mjs';
import { createHostedDatabase } from './postgres.mjs';
import { workspaceOperation } from './operations.mjs';

export function hostedConfig(env = process.env) {
  const appUrl = env.NEXTSTEP_APP_URL?.replace(/\/$/, '');
  const additionalAppUrl = env.NEXTSTEP_ADDITIONAL_APP_URL?.replace(/\/$/, '');
  const supabaseUrl = env.NEXTSTEP_SUPABASE_URL?.replace(/\/$/, '');
  const publishableKey = env.NEXTSTEP_SUPABASE_PUBLISHABLE_KEY;
  if (!appUrl || !supabaseUrl || !publishableKey || !env.NEXTSTEP_DATABASE_URL)
    throw new Error('Set the required hosted deployment variables.');
  for (const value of [appUrl, additionalAppUrl, supabaseUrl].filter(Boolean)) {
    const url = new URL(value);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash || (url.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname))))
      throw new Error('Use a complete HTTPS origin for hosted deployment URLs.');
  }
  if (/^(sb_secret_|eyJ)/.test(publishableKey)) throw new Error('Use a Supabase publishable key for authentication.');
  const databaseUrl = new URL(env.NEXTSTEP_DATABASE_URL);
  if (!['postgres:','postgresql:'].includes(databaseUrl.protocol) || databaseUrl.username.split('.')[0] !== 'nextstep_app' || databaseUrl.searchParams.get('sslmode') !== 'verify-full')
    throw new Error('Use the nextstep_app login with TLS certificate verification for the hosted database.');
  return { appUrl, additionalAppUrl, supabaseUrl, publishableKey, connectionString: databaseUrl.href, sslCa: env.NEXTSTEP_DATABASE_CA };
}

async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Use a JSON request.', 415);
  // The Vercel Node runtime may have parsed the body before calling the handler.
  if (req.body !== undefined) {
    let value;
    try { value = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body; }
    catch { throw new AppError('Invalid JSON request.'); }
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('Invalid JSON request.');
    if (Buffer.byteLength(JSON.stringify(value)) > 4 * 1024 * 1024) throw new AppError('This request is too large.',413);
    return value;
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += Buffer.byteLength(chunk);
    if (size > 4 * 1024 * 1024) throw new AppError('This request is too large.', 413);
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw new AppError('Invalid JSON request.'); }
}

export function createHostedHandler({ config = hostedConfig(), database = createHostedDatabase(config), authFactory = hostedAuth } = {}) {
  const origins = [config.appUrl, config.additionalAppUrl].filter(Boolean);
  const originsByHost = new Map(origins.map(origin => [new URL(origin).host, origin]));
  return async function handler(req, res) {
    const json = (status, value) => { res.statusCode = status; res.setHeader('Content-Type','application/json; charset=utf-8'); res.end(JSON.stringify(value)); };
    const redirect = (target) => { res.statusCode = 303; res.setHeader('Location', target); res.end(); };
    res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Vary','Cookie, Authorization');
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    try {
      const origin = originsByHost.get(req.headers.host);
      if (!origin) throw new AppError('Use the configured Nextstep address.', 403);
      if (req.headers.origin && req.headers.origin !== origin) throw new AppError('Requests must come from this app.', 403);
      const url = new URL(req.url, origin);
      const path = url.pathname;
      if (path === '/api/health' && req.method === 'GET') return json(200,{ status: 'ok', app: 'nextstep', mode: 'hosted' });
      if (!['GET','POST','PATCH','DELETE'].includes(req.method)) throw new AppError('Method not allowed.', 405);
      const credential = req.headers.authorization;
      const agent = credential?.startsWith('Bearer nextstep_');
      if (credential && !agent) throw new AppError('Invalid agent credential.', 401);
      if (!agent && req.method !== 'GET' && req.headers.origin !== origin) throw new AppError('Requests must come from this app.', 403);
      const auth = authFactory(req, res, { ...config, appUrl: origin });
      if (path === '/api/auth/login' && req.method === 'GET') return redirect(await auth.login());
      if (path === '/api/auth/callback' && req.method === 'GET') {
        if (url.searchParams.has('error')) return redirect(`${origin}/?signin=failed`);
        await auth.exchange(url.searchParams.get('code'));
        const identity = await auth.user();
        if (!identity) throw new AppError('Please sign in again.', 401);
        await database.memberships(identity, { claim: true });
        return redirect(origin);
      }
      if (path === '/api/auth/logout' && req.method === 'POST') {
        if (agent) throw new AppError('Use the browser to sign out.', 403);
        await auth.logout();
        return json(200,{ signedOut: true });
      }
      const identity = agent ? await database.authenticateAgent(credential.slice(7)) : await auth.user();
      if (path === '/api/auth/session' && req.method === 'GET') {
        if (!identity) return json(200,{ mode: 'hosted', authenticated: false });
        if (agent) throw new AppError('Use the browser for account settings.', 403);
        const workspaces = await database.memberships(identity);
        return json(200,{ mode: 'hosted', authenticated: true, user: { id: identity.id, email: identity.email }, workspaces });
      }
      if (!identity) throw new AppError('Sign in with Apple to continue.', 401);
      const workspaces = await database.memberships(identity);
      const workspaceId = identity.workspaceId || req.headers['x-nextstep-workspace'] || workspaces[0]?.id;
      if (!workspaces.some((workspace) => workspace.id === workspaceId)) { const error = new AppError('Your account has not been invited to this workspace.',403); error.accessDenied = true; throw error; }
      const input = req.method === 'GET' ? {} : await body(req);
      if (path === '/api/account/agent-tokens' && req.method === 'POST') return json(201,await database.createToken(identity, workspaceId, input.label));
      if (path === '/api/account/agent-tokens' && req.method === 'GET') {
        if (agent) throw new AppError('Sign in to manage agent connections.', 403);
        return json(200,await database.withWorkspace(identity, workspaceId, {}, async ({ client }) => ({ tokens: (await client.query('SELECT id,label,expires_at,revoked_at,created_at FROM nextstep.agent_tokens WHERE workspace_id=$1 AND user_id=$2 ORDER BY created_at DESC', [workspaceId,identity.id])).rows })));
      }
      const token = path.match(/^\/api\/account\/agent-tokens\/([a-f0-9-]{36})$/);
      if (token && req.method === 'DELETE') return json(200,await database.revokeToken(identity, workspaceId, token[1]));
      const operation = workspaceOperation(req.method, path, url.searchParams, input, identity, origin);
      const result = await database.withWorkspace(identity, workspaceId, operation, operation.run);
      if (path === '/api/crm/export') res.setHeader('Content-Disposition','attachment; filename="nextstep-workspace.json"');
      return json(200,result);
    } catch (error) {
      if (!(error instanceof AppError)) console.error('Nextstep hosted request failed', { code: error.code || 'internal_error' });
      return json(error instanceof AppError ? error.status : 503,{ error: error instanceof AppError ? error.message : 'Nextstep is temporarily unavailable. Please try again.', ...(error.status === 401 || error.accessDenied ? { authRequired: true } : {}) });
    }
  };
}
