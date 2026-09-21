import { DatabaseSync } from 'node:sqlite';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { openStore, AppError } from '../server/store.mjs';
import { readContext } from '../server/context.mjs';
import { researchInstructions, setupInstructions } from '../server/agent-instructions.mjs';
import { assertNextstepDatabase } from '../server/database-file.mjs';

const text = (limit = 8000) => z.string().max(limit);
const job = z.object({company:text(160),role:text(200),url:text(2000),location:text(200).optional(),salary:text(160).optional(),notes:text(20000).optional(),nextStep:text(500).optional()}).strict();

export function createNextstepMcp(database) {
  assertNextstepDatabase(database);
  const store = openStore(database);
  const db = new DatabaseSync(database,{readOnly:true});
  db.exec('PRAGMA busy_timeout = 5000;');
  const server = new McpServer({name:'nextstep',version:'0.2.0'},{instructions:researchInstructions});
  function tool(name,description,inputSchema,readOnly,handler) {
    server.registerTool(name,{description,inputSchema,annotations:{readOnlyHint:readOnly,destructiveHint:false,openWorldHint:false}},async input => {
      try { const value = await handler(input); return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value}; }
      catch (error) { return {isError:true,content:[{type:'text',text:error instanceof AppError ? error.message : 'Nextstep could not complete this operation. Check the connection and try again.'}]}; }
    });
  }
  tool('nextstep_get_context','Read current search preferences, every pipeline stage, removed jobs, recent decisions and search reports. Always call before researching or importing.',{afterActivityId:z.number().int().nonnegative().optional()},true,input => readContext(db,database,input.afterActivityId ?? 0));
  tool('nextstep_save_preferences','Save only preferences explicitly confirmed by the user during setup or an intentional edit. Never save inferred search adjustments here.',{version:z.number().int().nonnegative(),roles:text(2000).optional(),locations:text(2000).optional(),workStyle:text(1000).optional(),employmentType:text(1000).optional(),compensation:text(1000).optional(),experience:text().optional(),preferences:text(4000).optional(),exclusions:text(4000).optional()},false,input => ({profile:store.updateProfile(input)}));
  tool('nextstep_import_prospects','Preview or save verified new jobs at the top of Prospects. Existing stages, removed jobs and duplicates are preserved. Use dryRun:true first.',{opportunities:z.array(job).max(100),dryRun:z.boolean().default(true)},false,input => {
    if (!store.getProfile().roles.trim()) throw new AppError('Ask the user what kind of jobs they want and save those preferences before importing.');
    return store.importProspects(input.opportunities,{dryRun:input.dryRun});
  });
  tool('nextstep_record_search','Save a completed search report and tentative search adjustments supported by opportunity IDs. Does not edit preferences or existing jobs. Reuse the run ID on retry.',{id:text(100),summary:text(),learning:text().default(''),evidenceIds:z.array(z.string()).max(100).default([]),importedIds:z.array(z.string()).max(100).default([])},false,input => store.recordSearchRun(input));
  tool('nextstep_get_setup','Read the setup and scheduling handoff for the selected agent. The agent creates the task using its native scheduler.',{},true,() => ({instructions:setupInstructions(store.agentStatus().schedule)}));
  tool('nextstep_register_schedule','Record the task ID returned after the native agent scheduler confirms creation or update. This does not create, verify, pause or delete a scheduled task.',{version:z.number().int().nonnegative(),taskId:text(200)},false,input => ({schedule:store.updateSchedule(input,{registration:true})}));
  let closed = false;
  return {server,close:async () => { if (closed) return; closed = true; await server.close(); db.close(); store.close(); }};
}
