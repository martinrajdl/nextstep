import { AppError } from './errors.mjs';

// Remote data travels through a user-managed SSH tunnel. The bundled renderer
// stays local and never loads scripts or grants Electron privileges to a server.
export function backendOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new AppError('Enter the local address of your SSH tunnel.');
  }
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    !url.port ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new AppError(
      'Use an HTTP loopback address with a port, such as http://127.0.0.1:4319.',
    );
  }
  return url.origin;
}

export async function checkBackend(value) {
  const origin = backendOrigin(value);
  try {
    for (const path of ['/api/health', '/api/crm/context']) {
      const response = await fetch(origin + path, {
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      });
      if (
        !response.ok ||
        !response.headers.get('content-type')?.includes('application/json')
      )
        throw new Error();
      const result = await response.json();
      if (
        path.endsWith('health')
          ? result.app !== 'nextstep' || result.status !== 'ok'
          : !Array.isArray(result.collections) ||
            !result.connection?.mcpServers?.['nextstep-crm']
      )
        throw new Error();
    }
    return origin;
  } catch {
    throw new AppError(
      'Could not reach a compatible Nextstep backend. Start the server and SSH tunnel, then try again.',
      502,
    );
  }
}
