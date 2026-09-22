import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

const execute = promisify(execFile);
const providers = ['codex','claude-code'];
function validProvider(provider) {
  if (!providers.includes(provider)) throw new Error('Choose a supported desktop agent.');
}
function object(value) { return value && typeof value === 'object' && !Array.isArray(value); }
function existingConnection(existing, connection) {
  if (!existing) return false;
  const value = existing.transport || existing;
  const args = value.args;
  const database = connection.args.at(-1);
  if (value.type && value.type !== 'stdio' || !Array.isArray(args) || args.at(-2) !== '--database' || args.at(-1) !== database) {
    throw new Error('An existing “nextstep” connection points somewhere else. Keep it safe: use Advanced connection below to review the settings in your agent.');
  }
  if (existing.enabled === false) throw new Error('Nextstep is disabled in your agent settings. Enable it there, then try again.');
  return value.command === connection.command && JSON.stringify(args) === JSON.stringify(connection.args);
}

// Receives only main-process paths. Nothing from the renderer can select a file or command.
export function createAgentConnector({home,platform=process.platform,env=process.env,run=execute} = {}) {
  const appRoots = ['/Applications',join(home,'Applications')];
  const codexApp = appRoots.flatMap(root => ['Codex.app','ChatGPT.app'].map(name => join(root,name))).find(path => existsSync(join(path,'Contents/Resources/codex')));
  const claudeApp = appRoots.map(root => join(root,'Claude.app')).find(existsSync);
  const codex = codexApp && join(codexApp,'Contents/Resources/codex');
  const apps = {codex:codexApp,'claude-code':claudeApp};
  // Tests use a separate home and never write the user's agent settings.
  const codexHome = env.CODEX_HOME || join(home,'.codex');
  const cli = async args => {
    try { return await run(codex,args,{cwd:home,env:{...env,CODEX_HOME:codexHome},timeout:20000,maxBuffer:4*1024*1024}); }
    catch { throw new Error('Could not update Codex settings. Check that Codex can open, then retry or use Advanced connection.'); }
  };
  return {
    detect() { return providers.map(provider => ({provider,installed:platform === 'darwin' && Boolean(apps[provider]),canConnect:platform === 'darwin' && Boolean(apps[provider]),label:provider === 'codex' ? 'Codex' : 'Claude Code'})); },
    appPath(provider) { validProvider(provider); if (platform !== 'darwin' || !apps[provider]) throw new Error('Install the desktop agent first, then reopen Nextstep.'); return apps[provider]; },
    async connect(provider,connection) {
      validProvider(provider);
      if (platform !== 'darwin' || !apps[provider]) throw new Error('Install the desktop agent first, then reopen Nextstep. Advanced connection is also available below.');
      if (provider === 'codex') {
        mkdirSync(codexHome,{recursive:true});
        const read = async () => {
          const result = await cli(['mcp','list','--json']);
          let list; try { list = JSON.parse(result.stdout); } catch { throw new Error('Codex returned unexpected connection settings. Use Advanced connection.'); }
          if (!Array.isArray(list)) throw new Error('Codex returned unexpected connection settings. Use Advanced connection.');
          return list.find(server => server.name === 'nextstep');
        };
        const current = await read();
        if (!existingConnection(current,connection)) {
          // Check again immediately before writing. The official CLI preserves other settings.
          if (JSON.stringify(await read()) !== JSON.stringify(current)) throw new Error('Codex settings changed while connecting. Please try again.');
          await cli(['mcp','add','nextstep','--',connection.command,...connection.args]);
          if (!existingConnection(await read(),connection)) throw new Error('Codex did not retain the connection. Use Advanced connection.');
        }
      } else {
        if (env.CLAUDE_CONFIG_DIR) throw new Error('Claude uses a custom settings folder. Use Advanced connection to add Nextstep there.');
        // Claude Desktop gives this file precedence over the Code user settings.
        const desktopConfig = join(home,'Library/Application Support/Claude/claude_desktop_config.json');
        if (existsSync(desktopConfig)) {
          let desktop;
          try { desktop = JSON.parse(readFileSync(desktopConfig,'utf8')); } catch { throw new Error('Claude Desktop settings could not be read. Use Advanced connection.'); }
          if (desktop?.mcpServers?.nextstep && !existingConnection(desktop.mcpServers.nextstep,connection)) throw new Error('Nextstep is already configured in Claude Desktop settings. Update that existing connection using Advanced connection below.');
        }
        const path = join(home,'.claude.json');
        if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) throw new Error('Claude settings use a linked or unsupported file. Use Advanced connection.');
        const before = existsSync(path) ? readFileSync(path,'utf8') : null;
        let config;
        try { config = before === null ? {} : JSON.parse(before); } catch { throw new Error('Claude settings could not be read. Repair them in Claude or use Advanced connection.'); }
        if (!object(config) || config.mcpServers !== undefined && !object(config.mcpServers)) throw new Error('Claude settings have an unexpected format. Use Advanced connection.');
        if (!existingConnection(config.mcpServers?.nextstep,connection)) {
          const updated = {...config,mcpServers:{...config.mcpServers,nextstep:{type:'stdio',...connection}}};
          mkdirSync(dirname(path),{recursive:true});
          const temporary = `${path}.nextstep-${randomUUID()}.tmp`;
          try {
            writeFileSync(temporary,JSON.stringify(updated,null,2)+'\n',{mode:0o600,flag:'wx'});
            if ((existsSync(path) ? readFileSync(path,'utf8') : null) !== before) throw new Error('Claude settings changed while connecting. Please try again.');
            if (before !== null) writeFileSync(`${path}.nextstep-backup-${randomUUID()}`,before,{mode:0o600,flag:'wx'});
            renameSync(temporary,path);
          } finally { rmSync(temporary,{force:true}); }
        }
      }
      return {configured:true};
    }
  };
}
