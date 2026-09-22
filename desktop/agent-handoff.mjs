import { isAbsolute } from 'node:path';

// Use the new-conversation routes, never the app's last active Chat or Cowork tab.
export function agentHandoffUrl(provider, instructions, workspace) {
  if (!['codex','claude-code'].includes(provider)) throw new Error('Choose a supported desktop agent.');
  if (typeof instructions !== 'string' || !instructions.trim() || instructions.length > 12000) throw new Error('The agent request is empty or too long to open. Copy it from Nextstep instead.');
  if (typeof workspace !== 'string' || !isAbsolute(workspace)) throw new Error('The research folder must have an absolute path.');
  const claude = provider === 'claude-code';
  const url = new URL(claude ? 'claude://code/new' : 'codex://threads/new');
  url.searchParams.set(claude ? 'q' : 'prompt',instructions);
  url.searchParams.set(claude ? 'folder' : 'path',workspace);
  if (!claude) url.searchParams.set('mode','codex');
  return url.href;
}
