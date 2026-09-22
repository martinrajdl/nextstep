export type Provider = 'codex' | 'claude-code';
export type Schedule = {provider:Provider|'';cadence:string;timezone:string;taskId:string;reportedAt:string|null;version:number};
export type SearchRun = {id:string;summary:string;learning:string;createdAt:string;importedIds:string[]};
export type Onboarding = {status:'new'|'started'|'dismissed'|'complete';step:number;connectionToken:string;configuredProvider:string;configuredAt:string|null;connectedProvider:string;connectedAt:string|null;version:number};
export type AgentState = {schedule:Schedule;runs:SearchRun[];onboarding:Onboarding;database:string;connection:{mcpServers:{nextstep:{command:string;args:string[]}}}};
export type DesktopAgent = {provider:Provider;label:string;installed:boolean;canConnect:boolean};
declare global {
  interface Window {
    nextstepDesktop?: {
      getAgents:() => Promise<DesktopAgent[]>;
      connectAgent:(provider:Provider) => Promise<{configured:boolean}>;
      openAgent:(provider:Provider) => Promise<void>;
    };
  }
}
export const agentLabel = (provider:string) => provider === 'claude-code' ? 'Claude Code' : 'Codex';
export function connectionText(state:AgentState) {
  const connection = state.connection.mcpServers.nextstep;
  return state.schedule.provider === 'codex'
    ? `[mcp_servers.nextstep]\ncommand = ${JSON.stringify(connection.command)}\nargs = ${JSON.stringify(connection.args)}`
    : JSON.stringify(state.connection,null,2);
}
export function errorMessage(error:unknown) {
  const text = error instanceof Error ? error.message : 'Something went wrong. Please try again.';
  return text.replace(/^Error invoking remote method '[^']+': Error: /,'');
}
