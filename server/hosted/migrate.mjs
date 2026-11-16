import { readFileSync } from 'node:fs';

// Initial schema is additive and belongs to a separate, explicitly selected
// database. A version gate prevents replaying policy creation on later runs.
export async function migrateHosted(client) {
  await client.query('BEGIN');
  try {
    await client.query('SELECT pg_advisory_xact_lock(684923,1)');
    const installed = (await client.query("SELECT to_regclass('nextstep.schema_version') AS version_table,to_regclass('nextstep.workspaces') AS workspace_table")).rows[0];
    if (installed.version_table) {
      const version = (await client.query('SELECT version FROM nextstep.schema_version WHERE id=true')).rows[0]?.version;
      if (version !== 1) throw new Error('This database needs a compatible Nextstep schema migration.');
      await client.query('COMMIT');
      return { status: 'up_to_date', version };
    }
    if (installed.workspace_table) throw new Error('An unversioned hosted schema already exists. Review its migration history before upgrading.');
    await client.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));
    await client.query('COMMIT');
    return { status: 'migrated', version: 1 };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
}
