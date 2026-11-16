import { AppError } from '../server/errors.mjs';

export function createRemoteCrm({ server, workspace, credential, fetchImpl = fetch }) {
  let origin;
  try {
    const url = new URL(server);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1','localhost'].includes(url.hostname)))) throw new Error();
    origin = url.origin;
  } catch { throw new AppError('Use the complete HTTPS address of your Nextstep deployment.'); }
  if (!/^[a-f0-9-]{36}$/i.test(workspace || '') || !/^nextstep_[A-Za-z0-9_-]{43}$/.test(credential || ''))
    throw new AppError('Choose a workspace and a valid private agent credential.');
  async function request(path, method = 'GET', input) {
    let response;
    try {
      response = await fetchImpl(`${origin}${path}`, { method, redirect: 'error', signal: AbortSignal.timeout(25000), headers: {
        Authorization: `Bearer ${credential}`, 'X-Nextstep-Workspace': workspace,
        ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
      }, body: input === undefined ? undefined : JSON.stringify(input) });
    } catch { throw new AppError('Could not reach your hosted workspace. No local database has been used as a fallback.', 503); }
    const value = await response.json().catch(() => null);
    if (!response.ok || !value) throw new AppError(value?.error || 'Could not reach your hosted workspace.', response.status);
    return value;
  }
  const query = (path, input = {}) => request(`${path}?${new URLSearchParams(Object.entries(input).filter(([,value]) => value !== undefined).map(([key,value]) => [key,String(value)]))}`);
  return {
    context: () => request('/api/crm/context'),
    policy: () => request('/api/crm/policy'),
    query: input => request('/api/crm/query','POST',input),
    preview: input => request('/api/crm/preview','POST',input),
    propose: input => request('/api/crm/proposals','POST',input),
    agentApply: input => request('/api/crm/apply','POST',input),
    getRecord: async id => (await request(`/api/crm/records/${encodeURIComponent(id)}`)).record,
    getCollection: async id => (await request(`/api/crm/collections/${encodeURIComponent(id)}`)).collection,
    changes: async input => (await query('/api/crm/changes',input)).changes,
    history: async input => (await query('/api/crm/history',input)).events,
    notes: {
      get: id => request(`/api/notes/${encodeURIComponent(id)}`),
      list: input => query('/api/notes',input),
    },
    flows: {
      list: async input => (await query('/api/crm/flows',input)).flows,
      get: id => request(`/api/crm/flows/${encodeURIComponent(id)}`),
      report: input => request('/api/crm/flows/report','POST',input),
    },
  };
}
