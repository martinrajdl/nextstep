import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { exportSelectedWorkspace, importTransfer } from '../server/hosted/transfer.mjs';
import { postgresOptions } from '../server/hosted/postgres.mjs';
import { migrateHosted } from '../server/hosted/migrate.mjs';

const [command,...args] = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i+1] : undefined; };
async function main() {
  if (command === 'export') {
    const source = flag('--database'), selection = flag('--selection'), output = flag('--out');
    if (!source || !selection || !output || !existsSync(source) || existsSync(output)) throw new Error('Use export --database EXISTING_FILE --selection PRIVATE_JSON --out NEW_PRIVATE_JSON.');
    const transfer = exportSelectedWorkspace(resolve(source),JSON.parse(readFileSync(selection,'utf8')));
    writeFileSync(output,JSON.stringify(transfer),{mode:0o600,flag:'wx'});
    console.log(JSON.stringify({ status:'exported',fingerprint:transfer.fingerprint,counts:transfer.counts }));
    return;
  }
  const connectionString = process.env.NEXTSTEP_ADMIN_DATABASE_URL;
  if (!connectionString) throw new Error('Set NEXTSTEP_ADMIN_DATABASE_URL privately for this administrative command.');
  const client = new pg.Client(postgresOptions(connectionString,process.env.NEXTSTEP_DATABASE_CA));
  await client.connect();
  try {
    if (command === 'migrate') {
      if (!args.includes('--apply')) throw new Error('Use migrate --apply against the explicit destination project.');
      console.log(JSON.stringify({...await migrateHosted(client),runtimeRole:'nextstep_app'}));
    } else if (command === 'runtime-credential') {
      const output = flag('--out');
      if (!args.includes('--apply') || !output || existsSync(output)) throw new Error('Use runtime-credential --apply --out NEW_PRIVATE_FILE. Updating this login also requires updating the deployment secret.');
      const password = randomBytes(36).toString('base64url');
      // PostgreSQL identifiers are fixed; the generated password is base64url only.
      await client.query(`ALTER ROLE nextstep_app PASSWORD '${password}'`);
      writeFileSync(output,password,{mode:0o600,flag:'wx'}); chmodSync(output,0o600);
      console.log(JSON.stringify({status:'credential_saved',runtimeRole:'nextstep_app'}));
    } else if (command === 'workspace') {
      const input = JSON.parse(readFileSync(flag('--config'),'utf8'));
      if (!input.id || !input.name || !Array.isArray(input.members) || !input.members.some(member=>member.role==='owner')) throw new Error('Provide a workspace UUID, name and explicitly invited members including an owner.');
      await client.query('BEGIN');
      try {
        await client.query('INSERT INTO nextstep.workspaces(id,name,ready) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING',[input.id,input.name,input.ready !== false]);
        for (const member of input.members) await client.query('INSERT INTO nextstep.members(workspace_id,email,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,email) DO NOTHING',[input.id,member.email.toLowerCase(),member.role]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; }
      console.log(JSON.stringify({status:'configured',workspaceId:input.id,memberCount:input.members.length}));
    } else if (command === 'import') {
      const transfer = JSON.parse(readFileSync(flag('--file'),'utf8'));
      console.log(JSON.stringify(await importTransfer(client,flag('--workspace'),transfer,{apply:args.includes('--apply')})));
    } else throw new Error('Choose export, migrate, runtime-credential, workspace or import.');
  } finally { await client.end(); }
}
main().catch(error=>{ console.error(error.name === 'AppError' ? error.message : 'Hosted setup failed. Check the selected command and private connection settings.'); process.exitCode=1; });
