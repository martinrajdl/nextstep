import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import AppButton from '@/components/app-button';
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Bot,
  Check,
  ExternalLink,
  GitBranch,
  Search,
  Shapes,
  ShieldCheck,
} from 'lucide-react';
import { request } from '@/lib/model';
import { dateTime, errorMessage, type AgentFlow } from '@/lib/crm';
import Modal from './modal';

const stages = [
  ['sourcing', 'Find information', Search],
  ['shaping', 'Organize it', Shapes],
  ['review', 'Review changes', ShieldCheck],
  ['updating', 'Keep it up to date', GitBranch],
  ['complete', 'Complete', Check],
] as const;
export function FlowLifecycle() {
  return (
    <ol className="crm-flow-lifecycle" aria-label="Agent workflow lifecycle">
      {stages.slice(0, 4).map(([id, title, Icon], index) => (
        <li key={id}>
          <Icon size={17} />
          <span>
            <small>{index === 2 ? 'YOU' : 'YOUR AGENT'}</small>
            {title}
          </span>
          {index < 3 && <ArrowRight size={14} />}
        </li>
      ))}
    </ol>
  );
}
export function flowLabel(flow: AgentFlow) {
  if (flow.pendingCount) return 'Waiting for your review';
  if (flow.stage === 'review')
    return flow.changes.some((c) => c.status === 'rejected')
      ? 'Changes rejected'
      : 'Changes applied · ready to continue';
  return {
    sourcing: 'Finding information',
    shaping: 'Organizing information',
    updating: 'Updating saved information',
    complete: 'Agent reported complete',
    blocked: 'Needs attention',
  }[flow.stage];
}
export function FlowCard({
  flow,
  onClick,
}: {
  flow: AgentFlow;
  onClick: () => void;
}) {
  return (
    <AppButton tooltip={`View progress: ${flow.goal}`} className="crm-flow-card" onClick={onClick}>
      <span className="crm-flow-icon">
        <Bot size={20} />
      </span>
      <span className="crm-flow-description">
        <strong>{flow.goal}</strong>
        <span>{flow.message}</span>
        <small>
          {flow.actor} · {dateTime(flow.updatedAt)}
        </small>
      </span>
      <span
        className={`crm-flow-stage ${flow.pendingCount ? 'needs-review' : ''}`}
      >
        {flowLabel(flow)}
      </span>
      <ArrowRight size={16} />
    </AppButton>
  );
}
export default function AgentFlows({
  revision,
  onConnect,
}: {
  revision: number;
  onConnect: () => void;
}) {
  const [flows, setFlows] = useState<AgentFlow[]>([]),
    [error, setError] = useState(''),
    [selected, setSelected] = useState<AgentFlow | null>(null),
    [offset, setOffset] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      request<{ flows: AgentFlow[] }>(
        `/api/crm/flows?limit=25&offset=${offset}`,
      )
        .then((data) => {
          if (!cancelled) {
            setFlows(data.flows);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [revision, offset]);
  const selectedId = selected?.id;
  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    const refresh = () =>
      request<AgentFlow>(`/api/crm/flows/${encodeURIComponent(selectedId)}`)
        .then((flow) => {
          if (!cancelled) setSelected(flow);
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [selectedId]);
  return (
    <>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <div className="crm-flow-list">
        {flows.map((flow) => (
          <FlowCard
            key={flow.id}
            flow={flow}
            onClick={() => setSelected(flow)}
          />
        ))}
      </div>
      {!flows.length && (
        <div className="crm-empty crm-agent-empty">
          <Bot size={28} />
          <h2>No activity yet</h2>
          <p>Your agent’s progress and saved changes will appear here.</p>
          <AppButton className="crm-button" onClick={onConnect}>
            Set up an agent <ArrowRight size={16} />
          </AppButton>
        </div>
      )}
      {(offset > 0 || flows.length === 25) && (
        <div className="crm-pagination">
          <AppButton
            className="crm-button"
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 25))}
          >
            Previous
          </AppButton>
          <AppButton
            className="crm-button"
            disabled={flows.length < 25}
            onClick={() => setOffset((n) => n + 25)}
          >
            Next
          </AppButton>
        </div>
      )}
      {!!flows.length && <p className="crm-hint">Progress is reported by your agent. Saved changes are verified against your workspace history.</p>}
      {selected && (
        <Modal
          wide
          title={selected.goal}
          subtitle={`${selected.actor} · ${flowLabel(selected)}`}
          onClose={() => setSelected(null)}
        >
          <div className="crm-form-body crm-flow-detail">
            <div className="crm-flow-facts">
              <span>
                <strong>{selected.pendingCount}</strong> proposals waiting
              </span>
              <span>
                <strong>{selected.appliedCount}</strong> operations applied
              </span>
              <span>Updated {dateTime(selected.updatedAt)}</span>
            </div>
            <p className="crm-hint">
              Applied counts come from Nextstep’s change history. Progress
              messages and source links are reported by the agent.
            </p>
            {!!selected.changes.length && (
              <section>
                <h3>Changes in this flow</h3>
                {selected.changes.map((change) => (
                  <a
                    className="crm-flow-change"
                    key={change.id}
                    href={`#/review?change=${encodeURIComponent(change.id)}`}
                    onClick={() => setSelected(null)}
                  >
                    <span>{change.title}</span>
                    <small>
                      {change.status === 'approved'
                        ? 'applied after review'
                        : change.status}
                    </small>
                    <ArrowRight size={14} />
                  </a>
                ))}
              </section>
            )}
            <section>
              <h3>Agent progress</h3>
              <ol className="crm-flow-updates">
                {selected.updates?.map((update) => (
                  <li key={update.reportId}>
                    <small>
                      {dateTime(update.createdAt)} · {update.stage}
                    </small>
                    <p>{update.message}</p>
                    {update.sources.map((source) => (
                      <a
                        key={source.url}
                        href={source.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {source.label}
                        <ExternalLink size={12} />
                      </a>
                    ))}
                  </li>
                ))}
              </ol>
              {!selected.updates && <p>Loading progress…</p>}
            </section>
            {!!selected.sources?.length && (
              <Collapsible className="crm-details">
                <CollapsibleTrigger>
                  All reported sources ({selected.sources.length})
                </CollapsibleTrigger><CollapsibleContent>
                {selected.sources.map((source) => (
                  <a
                    className="crm-flow-source"
                    key={source.url}
                    href={source.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {source.label}
                    <ExternalLink size={12} />
                  </a>
                ))}
              </CollapsibleContent></Collapsible>
            )}
          </div>
          <footer>
            <AppButton className="crm-button" onClick={() => setSelected(null)}>
              Close
            </AppButton>
          </footer>
        </Modal>
      )}
    </>
  );
}
