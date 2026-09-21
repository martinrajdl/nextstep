import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const root = fileURLToPath(new URL('..', import.meta.url));

// The UI, setup command and importer must always resolve the same database.
export function databasePath(env = process.env) {
  return resolve(env.NEXTSTEP_DB_PATH || env.DB_PATH || resolve(root, 'data/nextstep.sqlite'));
}
