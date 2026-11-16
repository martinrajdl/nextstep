import { spawnSync } from 'node:child_process';
import electron from 'electron';
import { root } from '../server/config.mjs';

const executable=process.argv[2];
const result=spawnSync(process.execPath,['--test','--test-name-pattern=local MCP bridge','tests/hosted.test.mjs'],{
  cwd:root,stdio:'inherit',env:{...process.env,NEXTSTEP_TEST_MCP_EXECUTABLE:executable || electron,NEXTSTEP_TEST_MCP_SOURCE:executable ? '' : '1'},
});
process.exitCode=result.status ?? 1;
