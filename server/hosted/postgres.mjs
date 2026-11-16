import pg from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import { AppError } from '../errors.mjs';
import { openWorkspaceEngine, diffWorkspaceRows } from './workspace-engine.mjs';

export const hashToken = (token) => createHash('sha256').update(token).digest('hex');
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function postgresOptions(connectionString, ca) {
  const url = new URL(connectionString);
  if (!['postgres:','postgresql:'].includes(url.protocol) || url.searchParams.get('sslmode') !== 'verify-full')
    throw new Error('Use a Postgres connection with full TLS certificate verification.');
  // pg-connection-string otherwise replaces the explicit CA options with its own
  // SSL object when it sees sslmode. Verification is mandatory below.
  for (const name of ['sslmode','sslrootcert','sslcert','sslkey']) url.searchParams.delete(name);
  return { connectionString: url.href, ssl: { rejectUnauthorized: true, ...(ca ? { ca: ca.replaceAll('\\n','\n') } : {}) } };
}
export function createHostedDatabase({ connectionString, sslCa, pool = new pg.Pool({ ...postgresOptions(connectionString, sslCa), max: 1, idleTimeoutMillis: 10000, connectionTimeoutMillis: 10000 }) } = {}) {
  let checkedRole = false;
  const rowCache = new Map();
  let cachedBytes = 0;
  function cacheRows(id, revision, rows) {
    const previous = rowCache.get(id);
    if (previous && BigInt(previous.revision) > BigInt(revision)) return;
    if (previous) { cachedBytes -= previous.bytes; rowCache.delete(id); }
    const bytes = Buffer.byteLength(JSON.stringify(rows));
    while (rowCache.size && cachedBytes + bytes > 64 * 1024 * 1024) {
      const [key,value] = rowCache.entries().next().value;
      rowCache.delete(key); cachedBytes -= value.bytes;
    }
    rowCache.set(id,{ revision: String(revision), rows, bytes }); cachedBytes += bytes;
  }
  async function runtimeRole(client) {
    if (checkedRole) return;
    const role = (await client.query('SELECT current_user AS name,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    if (role?.name !== 'nextstep_app' || role.rolsuper || role.rolbypassrls)
      throw new Error('The hosted adapter requires the restricted nextstep_app database login.');
    checkedRole = true;
  }
  async function transaction(identity, fn) {
    const client = await pool.connect();
    try {
      await runtimeRole(client);
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout='12s'");
      await client.query("SELECT set_config('nextstep.user_id',$1,true),set_config('nextstep.email',$2,true)", [identity.id, identity.email?.toLowerCase() || '']);
      const committed = [];
      const result = await fn(client, callback => committed.push(callback));
      await client.query('COMMIT');
      for (const callback of committed) callback();
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async function memberships(identity, { claim = false } = {}) {
    return transaction(identity, async (client) => {
      if (claim && identity.email) await client.query('UPDATE nextstep.members SET user_id=$1 WHERE user_id IS NULL AND email=$2 AND disabled_at IS NULL', [identity.id, identity.email.toLowerCase()]);
      return (await client.query('SELECT w.id,w.name,m.role FROM nextstep.members m JOIN nextstep.workspaces w ON w.id=m.workspace_id WHERE m.user_id=$1 AND m.disabled_at IS NULL ORDER BY w.created_at,w.id', [identity.id])).rows;
    });
  }
  async function withWorkspace(identity, workspaceId, { write = false, owner = false, action = '', changeId = null } = {}, fn) {
    if (!uuid.test(workspaceId || '')) throw new AppError('Choose a workspace.', 400);
    return transaction(identity, async (client, onCommit) => {
      const member = (await client.query('SELECT role FROM nextstep.members WHERE user_id=$1 AND workspace_id=$2 AND disabled_at IS NULL FOR SHARE', [identity.id, workspaceId])).rows[0];
      if (!member) { const error = new AppError('Your account no longer has access to this workspace.',403); error.accessDenied = true; throw error; }
      if ((write && member.role === 'viewer') || (owner && member.role !== 'owner')) throw new AppError('You do not have access to this action.', 403);
      if (identity.tokenId) {
        const token = (await client.query('SELECT id FROM nextstep.agent_tokens WHERE id=$1 AND workspace_id=$2 AND user_id=$3 AND revoked_at IS NULL AND expires_at>now() FOR SHARE', [identity.tokenId, workspaceId, identity.id])).rows[0];
        if (!token) throw new AppError('This agent connection has expired or been revoked.', 401);
      }
      const workspace = (await client.query(`SELECT id,name,revision FROM nextstep.workspaces WHERE id=$1 ${write ? 'FOR UPDATE' : ''}`, [workspaceId])).rows[0];
      if (!workspace) throw new AppError('Workspace not found.', 404);
      // This is a disposable optimization, never an authorization or persistence
      // source. Every hit follows a live membership/token check and revision read.
      const cached = rowCache.get(workspaceId);
      const before = cached?.revision === String(workspace.revision) ? cached.rows :
        (await client.query('SELECT table_name AS table,row_id AS id,data FROM nextstep.entities WHERE workspace_id=$1 ORDER BY table_name,row_id', [workspaceId])).rows;
      const engine = openWorkspaceEngine(before);
      try {
        const result = await fn({ crm: engine.crm, client, member, workspace });
        let nextRows = before, nextRevision = workspace.revision;
        if (write) {
          nextRows = engine.rows();
          const { upserts, deletions } = diffWorkspaceRows(before, nextRows);
          if (upserts.length) await client.query(`INSERT INTO nextstep.entities(workspace_id,table_name,row_id,data)
            SELECT $1,x.table,x.id,x.data FROM jsonb_to_recordset($2::jsonb) AS x("table" text,id text,data jsonb)
            ON CONFLICT(workspace_id,table_name,row_id) DO UPDATE SET data=excluded.data`, [workspaceId, JSON.stringify(upserts)]);
          if (deletions.length) await client.query(`DELETE FROM nextstep.entities e USING jsonb_to_recordset($2::jsonb) AS x("table" text,id text)
            WHERE e.workspace_id=$1 AND e.table_name=x.table AND e.row_id=x.id`, [workspaceId, JSON.stringify(deletions)]);
          if (upserts.length || deletions.length) {
            await client.query('UPDATE nextstep.workspaces SET revision=revision+1 WHERE id=$1', [workspaceId]);
            nextRevision = String(BigInt(workspace.revision) + 1n);
          }
          if (action) await client.query('INSERT INTO nextstep.audit(workspace_id,user_id,agent_token_id,action,change_id) VALUES($1,$2,$3,$4,$5)', [workspaceId, identity.id, identity.tokenId || null, action, changeId]);
        }
        onCommit(() => cacheRows(workspaceId, nextRevision, nextRows));
        return result;
      } finally { engine.close(); }
    });
  }
  return {
    memberships, withWorkspace,
    async authenticateAgent(token) {
      if (!/^nextstep_[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError('Invalid agent credential.', 401);
      const client = await pool.connect();
      let value;
      try { await runtimeRole(client); value = (await client.query('SELECT * FROM nextstep.authenticate_agent($1)', [hashToken(token)])).rows[0]; }
      finally { client.release(); }
      if (!value) throw new AppError('This agent connection has expired or been revoked.', 401);
      return { id: value.user_id, workspaceId: value.workspace_id, tokenId: value.token_id, label: value.label, kind: 'agent' };
    },
    async createToken(identity, workspaceId, label) {
      if (identity.kind === 'agent') throw new AppError('Sign in to manage agent connections.', 403);
      if (typeof label !== 'string' || !label.trim() || label.length > 80) throw new AppError('Name this agent connection.');
      return withWorkspace(identity, workspaceId, { write: true, action: 'create_agent_token' }, async ({ client }) => {
        const token = `nextstep_${randomBytes(32).toString('base64url')}`;
        const value = (await client.query("INSERT INTO nextstep.agent_tokens(workspace_id,user_id,label,token_hash,expires_at) VALUES($1,$2,$3,$4,now()+interval '90 days') RETURNING id,label,expires_at", [workspaceId, identity.id, label.trim(), hashToken(token)])).rows[0];
        return { ...value, token };
      });
    },
    async revokeToken(identity, workspaceId, tokenId) {
      if (identity.kind === 'agent' || !uuid.test(tokenId || '')) throw new AppError('Sign in to manage agent connections.', 403);
      return withWorkspace(identity, workspaceId, { write: true, action: 'revoke_agent_token' }, async ({ client }) => {
        await client.query('UPDATE nextstep.agent_tokens SET revoked_at=now() WHERE id=$1 AND workspace_id=$2 AND user_id=$3', [tokenId, workspaceId, identity.id]);
        return { revoked: true };
      });
    },
    close: () => pool.end(),
  };
}
