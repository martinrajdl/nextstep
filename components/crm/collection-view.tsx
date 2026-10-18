import { useEffect, useState } from 'react';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpRight,
  Columns3,
  Filter as FilterIcon,
  Plus,
  Search,
  Settings2,
  Table2,
  Upload,
  X,
} from 'lucide-react';
import { request } from '@/lib/model';
import {
  applyChange,
  displayValue,
  errorMessage,
  queryRecords,
  type Collection,
  type Filter,
  type PageResult,
  type RecordItem,
  type Sort,
  type View,
} from '@/lib/crm';
import Modal from './modal';
import { arrangeStages, BoardSettingsButton, BoardSkeleton, RecordActions, useBoardSettings, type BoardSettings } from '../board-controls';

function ViewEditor({
  collection,
  view,
  layout,
  groupBy,
  filters,
  sort,
  boardSettings,
  onClose,
  onSaved,
}: {
  collection: Collection;
  view?: View;
  layout: 'table' | 'board';
  groupBy: string;
  filters: Filter[];
  sort: Sort;
  boardSettings: BoardSettings;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(view?.name || ''),
    [columns, setColumns] = useState(
      view?.columns || collection.fields.map((f) => f.key),
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function save(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      await applyChange(`Save ${name} view`, [
        {
          type: view ? 'update_view' : 'create_view',
          ...(view
            ? { id: view.id, version: view.version }
            : { collectionId: collection.id }),
          name,
          layout,
          groupBy,
          hiddenGroups: boardSettings.hiddenStages,
          quickActions: boardSettings.actionStages,
          stageOrder: boardSettings.stageOrder || [],
          stageNames: boardSettings.stageNames || {},
          filters,
          sort,
          columns,
        },
      ]);
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={view ? 'Update view' : 'Save view'}
      subtitle="Keep this layout, filter, sort and visible fields for you and your agents."
      onClose={onClose}
    >
      <form onSubmit={save}>
        <div className="crm-form-body">
          <label>
            View name
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <fieldset className="crm-multiselect">
            <legend>Visible fields</legend>
            {collection.fields.map((field) => (
              <label key={field.key}>
                <input
                  type="checkbox"
                  checked={columns.includes(field.key)}
                  onChange={(e) =>
                    setColumns(
                      e.target.checked
                        ? [...columns, field.key]
                        : columns.filter((k) => k !== field.key),
                    )
                  }
                />
                {field.name}
              </label>
            ))}
          </fieldset>
          {error && (
            <p role="alert" className="crm-error">
              {error}
            </p>
          )}
        </div>
        <footer>
          {view && (
            <button
              type="button"
              className="crm-button crm-archive-button"
              disabled={busy}
              onClick={() => {
                setBusy(true);
                applyChange(`Delete ${view.name} view`, [
                  { type: 'delete_view', id: view.id, version: view.version },
                ])
                  .then(onSaved)
                  .catch((e) => {
                    setError(errorMessage(e));
                    setBusy(false);
                  });
              }}
            >
              Delete view
            </button>
          )}
          <button type="button" className="crm-button" onClick={onClose}>
            Cancel
          </button>
          <button className="crm-button crm-button-primary" disabled={busy}>
            Save view
          </button>
        </footer>
      </form>
    </Modal>
  );
}
export default function CollectionView({
  collection,
  revision,
  onNew,
  onOpen,
  onSchema,
  onImport,
  onChanged,
}: {
  collection: Collection;
  revision: number;
  onNew: () => void;
  onOpen: (record: RecordItem) => void;
  onSchema: () => void;
  onImport: () => void;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<PageResult>({
    records: [],
    total: 0,
    offset: 0,
    nextOffset: null,
  });
  const [query, setQuery] = useState(''),
    [search, setSearch] = useState(''),
    [offset, setOffset] = useState(0),
    [archived, setArchived] = useState(false),
    [loadedKey, setLoadedKey] = useState(''),
    [error, setError] = useState('');
  const [layout, setLayout] = useState<'table' | 'board'>('table'),
    [groupBy, setGroupBy] = useState(
      collection.fields.find((f) => f.type === 'select')?.key || '',
    ),
    [viewId, setViewId] = useState('all');
  const [filters, setFilters] = useState<Filter[]>([]),
    [sort, setSort] = useState<Sort>({ field: 'updatedAt', direction: 'desc' }),
    [showFilter, setShowFilter] = useState(false),
    [viewEditor, setViewEditor] = useState(false),
    [moving, setMoving] = useState(false);
  const [dragged, setDragged] = useState<RecordItem | null>(null);
  const [related, setRelated] = useState<Record<string, RecordItem>>({});
  const view = collection.views?.find((v) => v.id === viewId);
  const stageOptions = collection.fields.find(f => f.key === groupBy)?.options || [];
  const defaultActions = stageOptions.filter(s => /^(done|complete[d]?|won|lost|rejected|cancelled|canceled|closed|accepted)$/i.test(s)).slice(0, 2);
  const boardPreferences = useBoardSettings(`collection:${collection.id}:${viewId}:${groupBy}`, {
    hiddenStages: view?.hiddenGroups || [],
    stageOrder: view?.stageOrder || [],
    stageNames: view?.stageNames || {},
    actionStages: view?.quickActions || (defaultActions.length ? defaultActions : stageOptions.slice(-1)),
  });
  const {hiddenStages, actionStages} = boardPreferences.settings;
  const visibleFields = collection.fields.filter(
    (f) => !view || view.columns.includes(f.key),
  );
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(query);
      setOffset(0);
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);
  const loadKey = JSON.stringify([
    collection.id,
    search,
    filters,
    sort,
    archived,
    offset,
  ]);
  const loading = loadKey !== loadedKey;
  useEffect(() => {
    let cancelled = false;
    queryRecords({
      collectionId: collection.id,
      search,
      filters,
      sort,
      archived,
      offset,
      limit: 50,
    })
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError('');
        }
      })
      .catch((e) => {
        if (!cancelled) setError(errorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadedKey(loadKey);
      });
    return () => {
      cancelled = true;
    };
  }, [
    collection.id,
    revision,
    search,
    filters,
    sort,
    archived,
    offset,
    loadKey,
  ]);
  useEffect(() => {
    const ids = [
      ...new Set(
        data.records.flatMap((record) =>
          collection.fields
            .filter((f) => f.type === 'relation')
            .flatMap((f) =>
              Array.isArray(record.values[f.key])
                ? (record.values[f.key] as string[])
                : [],
            ),
        ),
      ),
    ].slice(0, 200);
    if (!ids.length) return;
    let cancelled = false;
    request<{ records: RecordItem[] }>('/api/crm/records/resolve', 'POST', {
      ids,
    })
      .then((result) => {
        if (!cancelled)
          setRelated(Object.fromEntries(result.records.map((r) => [r.id, r])));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [data.records, collection.fields]);
  function selectView(id: string) {
    setViewId(id);
    setOffset(0);
    const chosen = collection.views?.find((v) => v.id === id);
    setLayout(chosen?.layout || 'table');
    setGroupBy(
      chosen?.groupBy ||
        collection.fields.find((f) => f.type === 'select')?.key ||
        '',
    );
    setFilters(chosen?.filters || []);
    setSort(chosen?.sort || { field: 'updatedAt', direction: 'desc' });
  }
  async function move(record: RecordItem, value: string) {
    if (moving || loading) return;
    setMoving(true);
    setError('');
    try {
      await applyChange(`Move ${record.title}`, [
        {
          type: 'update_record',
          id: record.id,
          version: record.version,
          collectionVersion: collection.version,
          values: { [groupBy]: value || null },
        },
      ]);
      await onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setMoving(false);
    }
  }
  async function archive(record: RecordItem) {
    if (moving || loading) return;
    setMoving(true);
    try {
      await applyChange(`${record.archivedAt ? 'Restore' : 'Archive'} ${record.title}`, [{type: record.archivedAt ? 'restore_record' : 'archive_record', id: record.id, version: record.version}]);
      await onChanged();
      setError('');
    } catch (e) { setError(errorMessage(e)); }
    finally { setMoving(false); }
  }
  function actions(record: RecordItem) {
    return <RecordActions title={record.title} stages={boardStages} current={String(record.values[groupBy] || '')} quickActions={actionStages} disabled={moving || loading} archived={archived} onMove={stage => void move(record, stage)} onArchive={() => void archive(record)}/>;
  }
  function exportRecords() {
    const payload = JSON.stringify(
      { collection, records: data.records },
      null,
      2,
    );
    const url = URL.createObjectURL(
      new Blob([payload], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `${collection.id}-visible-records.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const groups = [
    ...(collection.fields.find(f => f.key === groupBy)?.required ? [] : ['']),
    ...stageOptions,
  ];
  const boardStages = arrangeStages(groups.map(id => ({id,name:id || 'No status'})), boardPreferences.settings);
  const stageName = (id:string) => boardStages.find(s => s.id===id)?.name || id;
  return (
    <>
      <div className="crm-collection-heading">
        <div>
          <div className="crm-eyebrow">
            COLLECTION <span style={{ background: collection.color }} />
          </div>
          <h1>{collection.name}</h1>
          <p>
            {collection.description ||
              'A space for the information that matters.'}
          </p>
        </div>
        <div className="crm-heading-actions">
          <button className="crm-button" onClick={onSchema}>
            <Settings2 size={16} />
            Edit fields
          </button>
          <button className="crm-button crm-button-primary" onClick={onNew}>
            <Plus size={16} />
            New record
          </button>
        </div>
      </div>
      <div className="crm-saved-views">
        <button
          aria-pressed={viewId === 'all'}
          onClick={() => selectView('all')}
        >
          <Table2 size={15} />
          All records
        </button>
        {collection.views?.map((view) => (
          <button
            key={view.id}
            aria-pressed={viewId === view.id}
            onClick={() => selectView(view.id)}
          >
            {view.layout === 'board' ? (
              <Columns3 size={15} />
            ) : (
              <Table2 size={15} />
            )}{' '}
            {view.name}
          </button>
        ))}
        <button onClick={() => setViewEditor(true)}>
          <Plus size={14} />
          {view ? 'Edit view' : 'Save a view'}
        </button>
      </div>
      <div className="crm-toolbar">
        <label className="crm-search">
          <Search size={16} />
          <input
            aria-label="Search records"
            value={query}
            placeholder="Search this collection…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <button
          className={`crm-button ${filters.length ? 'crm-button-active' : ''}`}
          aria-expanded={showFilter}
          onClick={() => setShowFilter(!showFilter)}
        >
          <FilterIcon size={14} />
          Filter{filters.length ? ` · ${filters.length}` : ''}
        </button>
        <button
          className="crm-button"
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived);
            setOffset(0);
          }}
        >
          <Archive size={14} />
          {archived ? 'Archived' : 'Archive'}
        </button>
        {layout === 'board' && <BoardSettingsButton stages={groups.map(id => ({id, name:id || 'No status'}))} settings={boardPreferences.settings} onChange={value => void boardPreferences.save(value)} onAddStage={async name => {
          if (stageOptions.includes(name)) throw new Error('A stage with that name already exists.');
          await applyChange(`Add ${name} stage`, [{type:'update_collection',id:collection.id,version:collection.version,fields:collection.fields.map(f => f.key === groupBy ? {...f,options:[...(f.options || []),name]} : f)}]);
          await onChanged();
        }} error={boardPreferences.error}/>}
        <div className="crm-layout-switch" aria-label="View layout">
          <button
            aria-label="Table view"
            aria-pressed={layout === 'table'}
            onClick={() => setLayout('table')}
          >
            <Table2 size={16} />
          </button>
          <button
            aria-label="Board view"
            aria-pressed={layout === 'board'}
            disabled={!groupBy}
            title={groupBy ? 'Board view' : 'Add a select field to use a board'}
            onClick={() => setLayout('board')}
          >
            <Columns3 size={16} />
          </button>
        </div>
        <button
          className="crm-icon-button"
          aria-label="Import JSON"
          title="Import JSON"
          onClick={onImport}
        >
          <Upload size={16} />
        </button>
        <button
          className="crm-icon-button"
          aria-label="Export visible records"
          title="Export visible records"
          disabled={loading || Boolean(error)}
          onClick={exportRecords}
        >
          <ArrowDownToLine size={16} />
        </button>
      </div>
      {showFilter && (
        <div className="crm-filters">
          {filters.map((filter, index) => (
            <div key={index}>
              <select
                aria-label={`Filter ${index + 1} field`}
                value={filter.field}
                onChange={(e) => {
                  setFilters(
                    filters.map((f, i) =>
                      i === index
                        ? { ...f, field: e.target.value, value: '' }
                        : f,
                    ),
                  );
                  setOffset(0);
                }}
              >
                <option value="title">Title</option>
                {collection.fields.map((f) => (
                  <option key={f.key} value={f.key}>
                    {f.name}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Filter ${index + 1} operator`}
                value={filter.op}
                onChange={(e) => {
                  setFilters(
                    filters.map((f, i) =>
                      i === index
                        ? { ...f, op: e.target.value as Filter['op'] }
                        : f,
                    ),
                  );
                  setOffset(0);
                }}
              >
                {[
                  ['contains', 'contains'],
                  ['eq', 'is'],
                  ['empty', 'is empty'],
                  ['not_empty', 'is not empty'],
                  ['gte', 'at least'],
                  ['lte', 'at most'],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {!['empty', 'not_empty'].includes(filter.op) && (
                <input
                  aria-label={`Filter ${index + 1} value`}
                  value={String(filter.value ?? '')}
                  onChange={(e) => {
                    const type = collection.fields.find(
                      (f) => f.key === filter.field,
                    )?.type;
                    setFilters(
                      filters.map((f, i) =>
                        i === index
                          ? {
                              ...f,
                              value:
                                type === 'number' && e.target.value !== ''
                                  ? Number(e.target.value)
                                  : type === 'checkbox'
                                    ? e.target.value === 'true'
                                    : e.target.value,
                            }
                          : f,
                      ),
                    );
                    setOffset(0);
                  }}
                />
              )}
              <button
                className="crm-icon-button"
                aria-label={`Remove filter ${index + 1}`}
                onClick={() => {
                  setFilters(filters.filter((_, i) => i !== index));
                  setOffset(0);
                }}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <button
            className="crm-text-button"
            disabled={filters.length >= 10}
            onClick={() =>
              setFilters([
                ...filters,
                { field: 'title', op: 'contains', value: '' },
              ])
            }
          >
            <Plus size={14} />
            Add filter
          </button>
          <label>
            Sort
            <select
              aria-label="Sort field"
              value={sort.field}
              onChange={(e) => {
                setSort({ ...sort, field: e.target.value });
                setOffset(0);
              }}
            >
              <option value="updatedAt">Last updated</option>
              <option value="createdAt">Created</option>
              <option value="title">Title</option>
              {collection.fields.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <select
            aria-label="Sort direction"
            value={sort.direction}
            onChange={(e) => {
              setSort({
                ...sort,
                direction: e.target.value as Sort['direction'],
              });
              setOffset(0);
            }}
          >
            <option value="asc">Ascending</option>
            <option value="desc">Descending</option>
          </select>
        </div>
      )}
      {layout === 'board' && (
        <label className="crm-board-group">
          Group by
          <select
            aria-label="Board group"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value)}
          >
            {collection.fields
              .filter((f) => f.type === 'select')
              .map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                </option>
              ))}
          </select>
          <span>Drag a card or open its Actions menu.</span>
        </label>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <div aria-busy={loading}>
        {loading && !loadedKey ? <BoardSkeleton table={layout === 'table'}/> : !data.records.length ? (
          <div className="crm-empty">
            <Table2 size={32} />
            <h2>
              {loading
                ? 'Loading records…'
                : search || filters.length
                  ? 'No matching records.'
                  : archived
                    ? 'No archived records.'
                    : 'A clean slate.'}
            </h2>
            <p>
              {archived
                ? 'Archived records keep their history and can be restored.'
                : 'Add a record yourself, or ask your agent to shape the first batch.'}
            </p>
            {!archived && (
              <button className="crm-button" onClick={onNew}>
                <Plus size={15} />
                Add a record
              </button>
            )}
          </div>
        ) : layout === 'table' ? (
          <div className="crm-table-wrap">
            <table className="crm-table">
              <thead>
                <tr>
                  <th scope="col">
                    Title <span>{data.total}</span>
                  </th>
                  {visibleFields.map((field) => (
                    <th scope="col" key={field.key}>
                      {field.name}
                    </th>
                  ))}
                  <th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {data.records.map((record) => (
                  <tr key={record.id}>
                    <th scope="row">
                      <button disabled={loading} onClick={() => onOpen(record)}>
                        <span
                          className="crm-record-mark"
                          style={{
                            color: collection.color,
                            background: `${collection.color}15`,
                          }}
                        >
                          {record.title.slice(0, 2).toUpperCase()}
                        </span>
                        {record.title}
                        <ArrowUpRight size={13} />
                      </button>
                    </th>
                    {visibleFields.map((field) => {
                      const value = record.values[field.key];
                      return (
                        <td key={field.key}>
                          {field.type === 'relation' && Array.isArray(value) ? (
                            <div className="crm-relation-pills">
                              {value.slice(0, 3).map((id) => (
                                <span className="crm-pill" key={id}>
                                  {related[id]?.title || 'Linked record'}
                                </span>
                              ))}
                              {value.length > 3 && (
                                <span>+{value.length - 3}</span>
                              )}
                            </div>
                          ) : ['select', 'multiselect'].includes(field.type) &&
                            value ? (
                            <span className="crm-pill">
                              {displayValue(value)}
                            </span>
                          ) : field.type === 'url' && value ? (
                            <a
                              href={String(value)}
                              target="_blank"
                              rel="noreferrer"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {new URL(String(value)).hostname}
                              <ArrowUpRight size={11} />
                            </a>
                          ) : (
                            <span
                              className={
                                !value && value !== 0 ? 'crm-muted' : ''
                              }
                            >
                              {displayValue(value)}
                            </span>
                          )}
                        </td>
                      );
                    })}
                    <td className="crm-muted">
                      {new Date(record.updatedAt).toLocaleDateString(
                        undefined,
                        { month: 'short', day: 'numeric' },
                      )}
                    </td><td className="crm-table-actions">{actions(record)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="crm-board">
            {boardStages.filter(stage => !hiddenStages.includes(stage.id)).map(({id:group,name}) => (
              // Pointer drops have an equivalent keyboard-accessible Actions menu on each card.
              // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              <section
                key={group}
                aria-label={`${name} column`}
                onDragOver={(event) => {
                  if (!archived && dragged) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const record = data.records.find(
                    (r) =>
                      r.id ===
                      event.dataTransfer.getData('text/nextstep-record'),
                  );
                  setDragged(null);
                  if (record && !archived && dragged?.id === record.id) void move(record, group);
                }}
              >
                <header>
                  <span
                    className="crm-dot"
                    style={{ background: collection.color }}
                  />
                  <h2>{name}</h2>
                  <span>
                    {
                      data.records.filter(
                        (r) => (r.values[groupBy] || '') === group,
                      ).length
                    }
                  </span>
                </header>
                {data.records
                  .filter((r) => (r.values[groupBy] || '') === group)
                  .map((record) => (
                    // The record button and Actions menu provide keyboard access for this draggable card.
                    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
                    <article
                      key={record.id}
                      aria-label={record.title}
                      draggable={!archived && !moving && !loading}
                      onDragStart={(event) => {
                        event.dataTransfer.setData('text/nextstep-record', record.id);
                        event.dataTransfer.effectAllowed = 'move';
                        setDragged(record);
                      }}
                      onDragEnd={() => setDragged(null)}
                    >
                      <button onClick={() => onOpen(record)} disabled={loading}>
                        <strong>{record.title}</strong>
                        {visibleFields
                          .filter(
                            (f) =>
                              f.key !== groupBy &&
                              record.values[f.key] != null &&
                              f.type !== 'relation',
                          )
                          .slice(0, 2)
                          .map((f) => (
                            <span key={f.key}>
                              <small>{f.name}</small>
                              {displayValue(record.values[f.key])}
                            </span>
                          ))}
                      </button>
                      {actions(record)}
                    </article>
                  ))}
              </section>
            ))}
          </div>
        )}
      </div>
      {layout === 'board' && groups.every(g => hiddenStages.includes(g)) && <div className="crm-empty"><h2>All stages are hidden.</h2><button className="crm-button" onClick={() => void boardPreferences.save({...boardPreferences.settings, hiddenStages: []})}>Show all stages</button></div>}
      {dragged && !archived && <div className="board-action-dock" aria-label="Drag actions">
        {[...actionStages.filter(g => groups.includes(g) && g !== dragged.values[groupBy]).map(stage => ({id:stage,label:stageName(stage)})), {id:'__archive__',label:'Archive'}].map(action => (
          // Card actions provide the same operation to keyboard and touch users.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
          <section key={action.id} aria-label={`${action.label} drop target`} className="board-action-target" onDragOver={event => {event.preventDefault();event.dataTransfer.dropEffect='move';event.currentTarget.classList.add('drop-over');}} onDragLeave={event => event.currentTarget.classList.remove('drop-over')} onDrop={event => {
          event.preventDefault();
          if (event.dataTransfer.getData('text/nextstep-record') === dragged.id) { if (action.id === '__archive__') void archive(dragged); else void move(dragged,action.id); }
          setDragged(null);
        }}><strong>{action.label}</strong><small>Drop to {action.id === '__archive__' ? 'archive' : 'move'}</small></section>))}
      </div>}
      <div className="crm-pagination">
        <span>
          {data.total
            ? `${offset + 1}–${Math.min(offset + data.records.length, data.total)} of ${data.total} records`
            : '0 records'}
          {loading ? ' · Refreshing…' : ''}
        </span>
        <button
          className="crm-button"
          disabled={!offset || loading}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </button>
        <button
          className="crm-button"
          disabled={data.nextOffset === null || loading}
          onClick={() => setOffset(data.nextOffset!)}
        >
          Next
        </button>
      </div>
      {viewEditor && (
        <ViewEditor
          collection={collection}
          view={view}
          layout={layout}
          groupBy={groupBy}
          filters={filters}
          sort={sort}
          boardSettings={boardPreferences.settings}
          onClose={() => setViewEditor(false)}
          onSaved={async () => {
            setViewEditor(false);
            setViewId('all');
            await onChanged();
          }}
        />
      )}
    </>
  );
}
