import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const directory = mkdtempSync(join(tmpdir(),'nextstep-browser-'));
process.env.NEXTSTEP_DB_PATH = join(directory,'test.sqlite');
process.env.DB_PATH = process.env.NEXTSTEP_DB_PATH;
process.env.PORT = '4321';
process.on('exit',() => rmSync(directory,{recursive:true,force:true}));
await import('../server/index.mjs');
