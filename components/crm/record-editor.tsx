import AppButton from '@/components/app-button';
import { useEffect, useState } from 'react';
import { Archive, History, RotateCcw } from 'lucide-react';
import Modal from './modal';
import { request } from '@/lib/model';
import {
  applyChange,
  dateTime,
  errorMessage,
  queryRecords,
  type Collection,
  type Event,
  type Field,
  type RecordItem,
  type Value,
} from '@/lib/crm';

function RelationInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string[];
  onChange: (value: string[]) => void;
}) {
  const [search, setSearch] = useState(''),
    [records, setRecords] = useState<RecordItem[]>([]),
    [selected, setSelected] = useState<RecordItem[]>([]),
    [error, setError] = useState('');
  const selectedKey = value.join(',');
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      queryRecords({ collectionId: field.collection, search, limit: 50 })
        .then((result) => {
          if (!cancelled) {
            setRecords(result.records);
            setError('');
          }
        })
        .catch((e) => {
          if (!cancelled) setError(errorMessage(e));
        });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [field.collection, search]);
  useEffect(() => {
    let cancelled = false;
    if (!selectedKey) return;
    request<{ records: RecordItem[] }>('/api/crm/records/resolve', 'POST', {
      ids: selectedKey.split(','),
    })
      .then((data) => {
        if (!cancelled) setSelected(data.records);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedKey]);
  const activeSelected = selected.filter((r) => value.includes(r.id));
  const options = [
    ...activeSelected,
    ...records.filter((r) => !activeSelected.some((s) => s.id === r.id)),
  ];
  return (
    <fieldset className="crm-relation">
      <legend>
        {field.name}
        {field.required ? ' *' : ''}
      </legend>
      <input
        aria-label={`Search ${field.name}`}
        placeholder="Find a record to link…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="crm-relation-options">
        {options.map((record) => (
          <label key={record.id}>
            <input
              type="checkbox"
              checked={value.includes(record.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, record.id]
                    : value.filter((id) => id !== record.id),
                )
              }
            />
            {record.title}
            {record.archivedAt && <small>Archived</small>}
          </label>
        ))}
        {!options.length && (
          <p className="crm-hint">
            No matching records. Create records in the related collection first.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
export default function RecordEditor({
  collection,
  record,
  onClose,
  onSaved,
}: {
  collection: Collection;
  record: RecordItem | null;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [id] = useState(record?.id || crypto.randomUUID());
  const [title, setTitle] = useState(record?.title || ''),
    [values, setValues] = useState<Record<string, Value>>(record?.values || {}),
    [externalKey, setExternalKey] = useState(record?.externalKey || '');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [history, setHistory] = useState<Event[]>([]),
    [showHistory, setShowHistory] = useState(false),
    [dirty, setDirty] = useState(false);
  const setValue = (key: string, value: Value) => {
    setDirty(true);
    setValues((current) => ({ ...current, [key]: value }));
  };
  useEffect(() => {
    if (!record) return;
    let cancelled = false;
    request<{ events: Event[] }>(`/api/crm/history?entityId=${record.id}`)
      .then((data) => {
        if (!cancelled) setHistory(data.events);
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [record]);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await applyChange(`${record ? 'Update' : 'Add'} ${title}`, [
        {
          type: record ? 'update_record' : 'create_record',
          id,
          ...(record
            ? { version: record.version }
            : { collectionId: collection.id }),
          collectionVersion: collection.version,
          title,
          values,
          externalKey,
        },
      ]);
      await onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    if (!record) return;
    setBusy(true);
    setError('');
    try {
      await applyChange(
        `${record.archivedAt ? 'Restore' : 'Archive'} ${record.title}`,
        [
          {
            type: record.archivedAt ? 'restore_record' : 'archive_record',
            id: record.id,
            version: record.version,
          },
        ],
      );
      await onSaved();
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={record ? record.title : 'New record'}
      subtitle={collection.name}
      onClose={onClose}
      dirty={dirty}
    >
      <form onSubmit={save}>
        <div className="crm-form-body">
          {record?.archivedAt && (
            <p className="crm-notice">
              This record is archived. Restore it to edit its values.
            </p>
          )}
          <fieldset
            disabled={busy || Boolean(record?.archivedAt)}
            className="crm-record-fields"
          >
            <label>
              Title
              <input
                required
                maxLength={300}
                placeholder="Give this record a name"
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  setDirty(true);
                }}
              />
            </label>
            {collection.fields.map((field) => {
              const value = values[field.key];
              if (field.type === 'relation')
                return (
                  <RelationInput
                    key={field.key}
                    field={field}
                    value={Array.isArray(value) ? value : []}
                    onChange={(value) => setValue(field.key, value)}
                  />
                );
              if (field.type === 'checkbox')
                return (
                  <label className="crm-checkbox-label" key={field.key}>
                    <input
                      type="checkbox"
                      checked={value === true}
                      onChange={(e) => setValue(field.key, e.target.checked)}
                    />
                    {field.name}
                  </label>
                );
              if (field.type === 'multiselect')
                return (
                  <fieldset className="crm-multiselect" key={field.key}>
                    <legend>
                      {field.name}
                      {field.required ? ' *' : ''}
                    </legend>
                    {field.options?.map((option) => (
                      <label key={option}>
                        <input
                          type="checkbox"
                          checked={
                            Array.isArray(value) && value.includes(option)
                          }
                          onChange={(e) =>
                            setValue(
                              field.key,
                              e.target.checked
                                ? [
                                    ...(Array.isArray(value) ? value : []),
                                    option,
                                  ]
                                : (Array.isArray(value) ? value : []).filter(
                                    (v) => v !== option,
                                  ),
                            )
                          }
                        />
                        {option}
                      </label>
                    ))}
                  </fieldset>
                );
              return (
                <label key={field.key}>
                  {field.name}
                  {field.required ? ' *' : ''}
                  {field.type === 'longtext' ? (
                    <textarea
                      aria-label={field.name}
                      rows={4}
                      maxLength={20000}
                      required={field.required}
                      value={String(value ?? '')}
                      onChange={(e) => setValue(field.key, e.target.value)}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      aria-label={field.name}
                      required={field.required}
                      value={String(value ?? '')}
                      onChange={(e) =>
                        setValue(field.key, e.target.value || null)
                      }
                    >
                      <option value="">No value</option>
                      {field.options?.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      aria-label={field.name}
                      required={field.required}
                      type={
                        ['email', 'url', 'date', 'number'].includes(field.type)
                          ? field.type
                          : 'text'
                      }
                      step={field.type === 'number' ? 'any' : undefined}
                      value={String(value ?? '')}
                      onChange={(e) =>
                        setValue(
                          field.key,
                          field.type === 'number'
                            ? e.target.value === ''
                              ? null
                              : Number(e.target.value)
                            : e.target.value,
                        )
                      }
                    />
                  )}
                </label>
              );
            })}
            <details className="crm-details">
              <summary>Source identity</summary>
              <label>
                External key
                <input
                  value={externalKey}
                  maxLength={300}
                  onChange={(e) => {
                    setExternalKey(e.target.value);
                    setDirty(true);
                  }}
                />
                <small>
                  A stable source ID prevents duplicate imports, including
                  archived records.
                </small>
              </label>
            </details>
          </fieldset>
          {record && (
            <section className="crm-record-history">
              <AppButton
                className="crm-text-button"
                type="button"
                onClick={() => setShowHistory(!showHistory)}
              >
                <History size={15} />
                History · {history.length} changes
              </AppButton>
              {showHistory &&
                history.map((event) => (
                  <div key={event.id}>
                    <span>
                      <strong>{event.actor}</strong> ·{' '}
                      {event.action.replaceAll('_', ' ')}
                      <small>{dateTime(event.createdAt)}</small>
                    </span>
                    {event.after && typeof event.after.values === 'object' && typeof event.after.id === 'string' && !record.archivedAt && (
                      <AppButton
                        type="button"
                        className="crm-text-button"
                        onClick={() => {
                          const snapshot = event.after as unknown as RecordItem;
                          setTitle(snapshot.title);
                          setValues(
                            Object.fromEntries(
                              collection.fields.map((f) => [
                                f.key,
                                snapshot.values[f.key] ?? null,
                              ]),
                            ),
                          );
                          setExternalKey(snapshot.externalKey || '');
                          setDirty(true);
                        }}
                      >
                        Use these values
                      </AppButton>
                    )}
                  </div>
                ))}
            </section>
          )}
          {error && (
            <p className="crm-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer>
          {record && (
            <AppButton
              type="button"
              className="crm-button crm-archive-button"
              disabled={busy}
              onClick={() => {
                if (
                  !dirty ||
                  window.confirm('Discard edits and change archive status?')
                )
                  void archive();
              }}
            >
              {record.archivedAt ? (
                <RotateCcw size={15} />
              ) : (
                <Archive size={15} />
              )}{' '}
              {record.archivedAt ? 'Restore record' : 'Archive'}
            </AppButton>
          )}
          <AppButton
            type="button"
            className="crm-button"
            onClick={() => {
              if (!dirty || window.confirm('Discard your unsaved changes?'))
                onClose();
            }}
          >
            Cancel
          </AppButton>
          {!record?.archivedAt && (
            <AppButton disabled={busy} className="crm-button crm-button-primary">
              {busy ? 'Saving…' : record ? 'Save record' : 'Add record'}
            </AppButton>
          )}
        </footer>
      </form>
    </Modal>
  );
}
