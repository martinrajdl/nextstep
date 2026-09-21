import { copyFileSync, constants, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { databasePath, root } from '../server/config.mjs';
import { openStore } from '../server/store.mjs';

export function setupWorkspace({ database = databasePath(), profile = resolve(root, 'data/profile.md') } = {}) {
  const existingDatabase = existsSync(database);
  const store = openStore(database);
  store.close();
  mkdirSync(dirname(profile), { recursive: true });
  let createdProfile = false;
  try {
    copyFileSync(resolve(root, 'templates/profile.example.md'), profile, constants.COPYFILE_EXCL);
    createdProfile = true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return { database, existingDatabase, profile, createdProfile };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = setupWorkspace();
  console.log(`${result.existingDatabase ? 'Kept existing' : 'Created empty'} database: ${result.database}`);
  console.log(`${result.createdProfile ? 'Created' : 'Kept existing'} private search profile: ${result.profile}`);
  console.log('Next: edit data/profile.md for job collection, then pnpm build && pnpm background:start.');
}
