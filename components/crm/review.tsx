import { useEffect, useState } from 'react';
import { ArrowRight, Check, CheckCheck, Code2, Inbox, X } from 'lucide-react';
import { request } from '@/lib/model';
import {
  dateTime,
  displayValue,
  errorMessage,
  type Change,
  type Diff,
} from '@/lib/crm';
import Modal from './modal';
function flatten(
  snapshot: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!snapshot) return {};
  const {
    id: _id,
    version: _version,
    createdAt: _created,
    updatedAt: _updated,
    collectionId: _collection,
    ...data
  } = snapshot;
  return {
    ...data,
    ...(data.values && typeof data.values === 'object' ? data.values : {}),
    values: undefined,
  };
}
export function DiffView({ diff }: { diff: Diff }) {
  const before = flatten(diff.before),
    after = flatten(diff.after);
  const keys = [
    ...new Set([...Object.keys(before), ...Object.keys(after)]),
  ].filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  const render = (value: unknown) =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? JSON.stringify(value)
      : Array.isArray(value) && value.some((v) => typeof v === 'object')
        ? JSON.stringify(value, null, 2)
        : displayValue(value);
  return (
    <article className="crm-diff">
      <header>
        <span
          className={`crm-change-action ${diff.action.startsWith('create') ? 'create' : ''}`}
        >
          {diff.action.replaceAll('_', ' ')}
        </span>
        <strong>
          {displayValue(
            diff.after?.title ||
              diff.after?.name ||
              diff.before?.title ||
              diff.before?.name ||
              diff.entityId,
          )}
        </strong>
      </header>
      {keys.map((key) => (
        <div className="crm-diff-row" key={key}>
          <span>{key}</span>
          <div>
            {diff.before && <del>{render(before[key])}</del>}
            <ArrowRight size={13} />
            <ins>{render(after[key])}</ins>
          </div>
        </div>
      ))}
    </article>
  );
}
export default function Review({
  onChanged,
  revision,
}: {
  onChanged: () => Promise<void>;
  revision: number;
}) {
  const [changes, setChanges] = useState<Change[]>([]),
    [scope, setScope] = useState<'pending' | 'reviewed'>('pending'),
    [selected, setSelected] = useState<Change | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [loadedKey, setLoadedKey] = useState('');
  const loadKey = `${scope}:${revision}:${offset}`;
  const loading = loadedKey !== loadKey;
  useEffect(() => {
    const id = new URLSearchParams(window.location.hash.split('?')[1]).get(
      'change',
    );
    if (!id) return;
    let cancelled = false;
    request<Change>(`/api/crm/changes/${encodeURIComponent(id)}`)
      .then((change) => {
        if (!cancelled) setSelected(change);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    request<{ changes: Change[] }>(
      `/api/crm/changes?${scope === 'pending' ? 'status=pending&' : ''}offset=${offset}&limit=50`,
    )
      .then((data) => {
        if (!cancelled) {
          setChanges(data.changes);
          setError('');
        }
      })
      .catch((error) => {
        if (!cancelled) setError(errorMessage(error));
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(loadKey);
      });
    return () => {
      cancelled = true;
    };
  }, [scope, revision, offset, loadKey]);
  async function review(decision: 'approve' | 'reject') {
    if (!selected) return;
    setBusy(true);
    setError('');
    try {
      await request(
        `/api/crm/changes/${encodeURIComponent(selected.id)}/review`,
        'POST',
        { version: selected.version, decision },
      );
      setSelected(null);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const visible =
    scope === 'pending'
      ? changes
      : changes.filter((c) => c.status !== 'pending');
  return (
    <>
      <div className="crm-page-heading">
        <div className="crm-eyebrow">HUMAN IN THE LOOP</div>
        <h1>Review changes</h1>
        <p>Your agents do the groundwork. You make the call.</p>
      </div>
      <div className="crm-view-tabs">
        <button
          aria-pressed={scope === 'pending'}
          onClick={() => {
            setScope('pending');
            setOffset(0);
          }}
        >
          Needs review
        </button>
        <button
          aria-pressed={scope === 'reviewed'}
          onClick={() => {
            setScope('reviewed');
            setOffset(0);
          }}
        >
          History
        </button>
      </div>
      {error && !selected && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      {!visible.length ? (
        <div className="crm-empty">
          <Inbox size={34} />
          <h2>
            {loading
              ? 'Loading changes…'
              : scope === 'pending'
                ? 'You’re all caught up.'
                : 'No reviewed changes yet.'}
          </h2>
          <p>
            Agents submit proposals here. Nothing changes until you approve.
          </p>
        </div>
      ) : (
        <div className="crm-review-list">
          {visible.map((change) => (
            <button
              key={change.id}
              onClick={() => {
                setError('');
                setSelected(change);
              }}
            >
              <span className="crm-review-symbol">
                {change.status === 'pending' ? (
                  <Code2 size={20} />
                ) : (
                  <CheckCheck size={20} />
                )}
              </span>
              <span>
                <strong>{change.title}</strong>
                <small>
                  {change.actor} · {change.operations.length}{' '}
                  {change.operations.length === 1 ? 'operation' : 'operations'}{' '}
                  · {dateTime(change.createdAt)}
                </small>
                {change.summary && <p>{change.summary}</p>}
              </span>
              <span className={`crm-pill ${change.status}`}>
                {change.status}
              </span>
              <ArrowRight size={17} />
            </button>
          ))}
        </div>
      )}
      <div className="crm-pagination">
        <button
          className="crm-button"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          className="crm-button"
          disabled={changes.length < 50}
          onClick={() => setOffset(offset + 50)}
        >
          Next
        </button>
      </div>
      {selected && (
        <Modal
          wide
          title={selected.title}
          subtitle={`${selected.actor} · ${selected.operations.length} operations · ${selected.status}`}
          onClose={() => {
            if (!busy) setSelected(null);
          }}
        >
          <div className="crm-form-body">
            {selected.summary && (
              <p className="crm-review-summary">{selected.summary}</p>
            )}
            {selected.status === 'pending' && (
              <p className="crm-notice">
                This entire change is applied together. If any record or schema
                has changed since it was proposed, approval stops without
                applying it.
              </p>
            )}
            {selected.result.map((diff, index) => (
              <DiffView key={index} diff={diff} />
            ))}
            <details className="crm-details">
              <summary>Inspect JSON</summary>
              <pre>{JSON.stringify(selected.operations, null, 2)}</pre>
            </details>
            {error && (
              <p className="crm-error" role="alert">
                {error}
              </p>
            )}
          </div>
          <footer>
            {selected.status === 'pending' ? (
              <>
                <button
                  disabled={busy}
                  className="crm-button"
                  onClick={() => void review('reject')}
                >
                  <X size={15} />
                  Reject
                </button>
                <button
                  disabled={busy}
                  className="crm-button crm-button-primary"
                  onClick={() => void review('approve')}
                >
                  <Check size={15} />
                  {busy ? 'Saving…' : 'Approve change'}
                </button>
              </>
            ) : (
              <button className="crm-button" onClick={() => setSelected(null)}>
                Close
              </button>
            )}
          </footer>
        </Modal>
      )}
    </>
  );
}
