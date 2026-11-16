import { createHostedHandler } from '../server/hosted/http.mjs';

let handler;
export default async function hostedNextstep(req, res) {
  try {
    const url = new URL(req.url,'http://localhost');
    if(url.searchParams.has('__nextstep_path')) {
      const path = url.searchParams.get('__nextstep_path');
      url.searchParams.delete('__nextstep_path');
      req.url = `/api/${path}${url.searchParams.size ? `?${url.searchParams}` : ''}`;
    }
    handler ??= createHostedHandler();
    return await handler(req, res);
  } catch {
    res.writeHead(503, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'This Nextstep deployment is not configured.' }));
  }
}
