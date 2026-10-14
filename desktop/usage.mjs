import { createHash, randomBytes } from 'node:crypto';

export const usageEndpoint = 'https://nextstep-website-lemon.vercel.app/api/usage';

// Independent of the CRM store: this module has no access to records or agents.
export function createUsageReporter({read, write, version, platform, eligible = () => true, send = fetch, now = Date.now}) {
  let request;
  let retryAfter = 0;
  const state = () => read().usageAnalytics || {};
  function setEnabled(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('Choose whether to share anonymous usage.');
    request?.abort();
    retryAfter = 0;
    const previous = state();
    write({usageAnalytics:enabled ? {
      enabled:true,
      seed:previous.enabled && /^[a-f0-9]{64}$/.test(previous.seed) ? previous.seed : randomBytes(32).toString('hex'),
      lastSentDay:previous.enabled ? previous.lastSentDay || null : null,
    } : {enabled:false}});
    return enabled;
  }
  async function checkIn() {
    const before = state();
    const timestamp = now();
    const day = new Date(timestamp).toISOString().slice(0,10);
    if (!eligible() || before.enabled !== true || !/^[a-f0-9]{64}$/.test(before.seed) || before.lastSentDay === day || timestamp < retryAfter || request) return false;
    const controller = new AbortController();
    request = controller;
    retryAfter = timestamp + 60 * 60 * 1000;
    try {
      const response = await send(usageEndpoint,{
        method:'POST', credentials:'omit', redirect:'error', referrerPolicy:'no-referrer',
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8000)]),
        headers:{'content-type':'application/json','user-agent':`Nextstep/${version}`},
        body:JSON.stringify({schema:1,day,dailyId:createHash('sha256').update(`nextstep-v1:${day}:${before.seed}`).digest('hex'),version,platform}),
      });
      // A settings change during the request must never re-enable reporting.
      const current = state();
      if (response.status !== 204 || current.enabled !== true || current.seed !== before.seed || controller.signal.aborted) return false;
      write({usageAnalytics:{...current,lastSentDay:day}});
      return true;
    } catch { return false; } // Offline reporting must never interfere with the app.
    finally { if (request === controller) request = undefined; }
  }
  return {setEnabled,checkIn,stop:() => request?.abort()};
}
