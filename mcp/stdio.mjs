import { resolve, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { databasePath } from '../server/config.mjs';
import { createNextstepMcp } from './server.mjs';

export function databaseArgument(args = process.argv.slice(2)) {
  const index = args.indexOf('--database');
  if (index < 0) return databasePath();
  if (!args[index+1] || !isAbsolute(args[index+1])) throw new Error('--database needs an absolute SQLite file path.');
  return resolve(args[index+1]);
}

export async function startMcp(database, onClose = () => {}) {
  const service = createNextstepMcp(database);
  const transport = new StdioServerTransport();
  await service.server.connect(transport);
  const finish = async () => { await service.close(); onClose(); };
  const protocolClose = transport.onclose;
  transport.onclose = () => { protocolClose?.(); void finish(); };
  process.once('SIGINT',finish); process.once('SIGTERM',finish);
  return service;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  startMcp(databaseArgument()).catch(error => { console.error(error.message); process.exitCode = 1; });
}
