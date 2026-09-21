const normalized = value => String(value || '').normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
export const companyKey = job => normalized(job.company);

export function opportunityKeys(job) {
  const keys = [];
  if (job.company && job.role) keys.push(`role:${companyKey(job)}|${normalized(job.role)}`);
  if (!job.url) return keys;
  try {
    const url = new URL(job.url);
    const uuid = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
    const id = url.searchParams.get('ashby_jid')?.match(new RegExp(`^${uuid}$`,'i'))?.[0]
      || url.pathname.match(new RegExp(`(?:^|/)(${uuid})(?:/|$)`,'i'))?.[1];
    if (id) keys.push(`requisition:${id.toLowerCase()}`);
    const greenhouseId = url.searchParams.get('gh_jid') || (/greenhouse\.io$/i.test(url.hostname) ? url.pathname.match(/\/jobs\/(\d+)/)?.[1] : null);
    if (greenhouseId) keys.push(`greenhouse:${greenhouseId}`);
    for (const name of [...url.searchParams.keys()]) {
      if (/^utm_/i.test(name) || ['ref','referrer','source','gh_src'].includes(name.toLowerCase())) url.searchParams.delete(name);
    }
    url.searchParams.sort();
    if (['#application','#overview'].includes(url.hash)) url.hash = '';
    let pathname = url.pathname.replace(/\/+$/,'');
    if (/^(jobs\.ashbyhq\.com|jobs\.lever\.co)$/i.test(url.hostname)) pathname = pathname.replace(/\/(application|apply)$/i,'');
    keys.push(`url:${url.hostname.toLowerCase().replace(/^www\./,'')}${url.port ? `:${url.port}` : ''}${pathname}${url.search}${url.hash}`);
  } catch { /* Invalid URLs are rejected by the store before importing. */ }
  return keys;
}
