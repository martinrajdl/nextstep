import { useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import AppButton from '@/components/app-button';
import AgentFlows from './agent-flows';
import AgentTools from './agent-tools';
import type { Workspace } from '@/lib/crm';

export default function AgentPage({ workspace, revision, onWorkbench, onNewCollection, onReview }: {
  workspace: Workspace;
  revision: number;
  onWorkbench: () => void;
  onNewCollection: () => void;
  onReview: () => void;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const setupButton = useRef<HTMLButtonElement>(null);
  return <div className="crm-agent-page">
    <div className="crm-agent-heading">
      <div><h1>Agent</h1><p>Follow your agent’s work and see what changed.</p></div>
      <AppButton
        ref={setupButton}
        className="crm-button crm-agent-setup-toggle"
        aria-expanded={setupOpen}
        aria-controls="agent-connection"
        onClick={() => setSetupOpen(value => !value)}
      >Connection & instructions<ChevronDown size={15}/></AppButton>
    </div>
    <section id="agent-connection" aria-label="Connection and instructions" hidden={!setupOpen}>
      <AgentTools embedded workspace={workspace} onWorkbench={onWorkbench} onNewCollection={onNewCollection} onReview={onReview}/>
    </section>
    <AgentFlows revision={revision} onConnect={() => {
      setSetupOpen(true);
      setupButton.current?.focus();
      setupButton.current?.scrollIntoView({ block: 'nearest' });
    }}/>
  </div>;
}
