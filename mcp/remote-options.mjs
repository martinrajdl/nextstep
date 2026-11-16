import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createRemoteCrm } from './remote-crm.mjs';

// Shared by Node and packaged Electron so hosted connections never consult a
// saved local database, including when their arguments or credentials are bad.
export function remoteCrmArgument(args = process.argv.slice(2), env = process.env) {
  const flags = ['--server','--workspace','--credential-file'];
  if (!flags.some(flag => args.includes(flag))) return undefined;
  const value = (flag, required = true) => {
    const index = args.indexOf(flag);
    if (index < 0 && !required) return undefined;
    if (index < 0 || args.lastIndexOf(flag) !== index || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error(`${flag} needs one value for a hosted connection.`);
    return args[index + 1];
  };
  if (args.includes('--database')) throw new Error('Choose either a hosted workspace or a local database for this connection.');
  const server = value('--server'), workspace = value('--workspace');
  const file = value('--credential-file', false);
  let credential = env.NEXTSTEP_AGENT_TOKEN;
  if (file) {
    if (!isAbsolute(file)) throw new Error('Use an absolute path to the private agent credential file.');
    const info = statSync(file);
    if (!info.isFile() || (info.mode & 0o077)) throw new Error('Restrict the agent credential file to your user (chmod 600).');
    credential = readFileSync(file,'utf8').trim();
  }
  return createRemoteCrm({server,workspace,credential});
}
