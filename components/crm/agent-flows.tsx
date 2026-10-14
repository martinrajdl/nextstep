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
    <button className="crm-flow-card" onClick={onClick}>
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
    </button>
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
      <div className="crm-page-heading">
        <div className="crm-eyebrow">
          AGENTS DO THE WORK. YOU SEE IT HAPPEN.
        </div>
        <h1>Agent progress</h1>
        <p>
          See what your agent is finding, organizing, or updating. Agents report
          their progress here; Nextstep shows which changes were saved.
        </p>
      </div>
      <FlowLifecycle />
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
        <div className="crm-empty">
          <Bot size={36} />
          <h2>Give your agent a direction.</h2>
          <p>
            Find contacts. Build a research library. Keep a project moving. Your
            agent reports its flow here as it works.
          </p>
          <button className="crm-button crm-button-primary" onClick={onConnect}>
            Connect an agent & write a brief <ArrowRight size={16} />
          </button>
        </div>
      )}
      {(offset > 0 || flows.length === 25) && (
        <div className="crm-pagination">
          <button
            className="crm-button"
            disabled={!offset}
            onClick={() => setOffset((n) => Math.max(0, n - 25))}
          >
            Previous
          </button>
          <button
            className="crm-button"
            disabled={flows.length < 25}
            onClick={() => setOffset((n) => n + 25)}
          >
            Next
          </button>
        </div>
      )}
      <p className="crm-hint">
        Progress is reported by your connected agent. Nextstep does not run or
        schedule agents. The last update time shows how fresh each report is.
      </p>
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
              <details className="crm-details">
                <summary>
                  All reported sources ({selected.sources.length})
                </summary>
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
              </details>
            )}
          </div>
          <footer>
            <button className="crm-button" onClick={() => setSelected(null)}>
              Close
            </button>
          </footer>
        </Modal>
      )}
    </>
  );
}
