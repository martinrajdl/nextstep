import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';
import { useCollectionLayout } from './use-collection-layout';
import AppButton, { ButtonTooltip } from '@/components/app-button';
import { useEffect, useState } from 'react';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import {
  Archive,
  ArrowUpRight,
  Columns3,
  Filter as FilterIcon,
  MoreHorizontal,
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
          <Label>
            View name
            <Input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </Label>
          <fieldset className="crm-multiselect">
            <legend>Visible fields</legend>
            {collection.fields.map((field) => (
              <Label key={field.key}>
                <Checkbox
                  checked={columns.includes(field.key)}
                  onCheckedChange={(e) =>
                    setColumns(
                      e
                        ? [...columns, field.key]
                        : columns.filter((k) => k !== field.key),
                    )
                  }
                />
                {field.name}
              </Label>
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
            <AppButton
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
            </AppButton>
          )}
          <AppButton type="button" className="crm-button" onClick={onClose}>
            Cancel
          </AppButton>
          <AppButton className="crm-button crm-button-primary" disabled={busy}>
            Save view
          </AppButton>
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
  const initialView = collection.views?.[0];
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
  const [layout, setLayout] = useCollectionLayout(collection.id, initialView?.layout || 'table', collection.fields.some(f => f.type === 'select'));
  const [groupBy, setGroupBy] = useState(
      initialView?.groupBy || collection.fields.find((f) => f.type === 'select')?.key || '',
    ),
    [viewId, setViewId] = useState(initialView?.id || 'all');
  const [filters, setFilters] = useState<Filter[]>(initialView?.filters || []),
    [sort, setSort] = useState<Sort>(initialView?.sort || { field: 'position', direction: 'asc' }),
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
  }, groupBy === 'stage' ? collection.importedSettingsKey : undefined);
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
    setSort(chosen?.sort || { field: 'position', direction: 'asc' });
  }
  async function move(record: RecordItem, value: string, beforeId?: string) {
    if (moving || loading) return;
    setMoving(true);
    setError('');
    try {
      await applyChange(`Move ${record.title}`, [
        {
          type: 'move_record',
          id: record.id,
          version: record.version,
          collectionVersion: collection.version,
          field: groupBy,
          value: value || null,
          ...(beforeId ? {beforeId} : {}),
        },
      ]);
      setSort({field:'position', direction:'asc'});
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
  const groups = [
    ...(collection.fields.find(f => f.key === groupBy)?.required ? [] : ['']),
    ...stageOptions,
  ];
  const boardStages = arrangeStages(groups.map(id => ({id,name:id || 'No status'})), boardPreferences.settings);
  const stageName = (id:string) => boardStages.find(s => s.id===id)?.name || id;
  return (
    <>
      <section className="crm-collection-controls" aria-label="Collection controls">
        <div className="crm-layout-switch" aria-label="View layout">
          <AppButton
            aria-label="Table view"
            aria-pressed={layout === 'table'}
            title="Table view"
            onClick={() => setLayout('table')}
          >
            <Table2 size={16} />
          </AppButton>
          <AppButton
            aria-label="Board view"
            aria-pressed={layout === 'board'}
            disabled={!groupBy}
            title={groupBy ? 'Board view' : 'Add a select field to use a board'}
            onClick={() => setLayout('board')}
          >
            <Columns3 size={16} />
          </AppButton>
        </div>
        {layout === 'board' && (
          <Label className="crm-board-group">
            Group by
            <NativeSelect aria-label="Board group" value={groupBy} onChange={event => setGroupBy(event.target.value)}>
              {collection.fields.filter(field => field.type === 'select').map(field => <NativeSelectOption key={field.key} value={field.key}>{field.name}</NativeSelectOption>)}
            </NativeSelect>
          </Label>
        )}
        <Label className="crm-search">
          <Search size={16} />
          <Input
            aria-label="Search records"
            value={query}
            placeholder="Search this collection…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Label>
        <AppButton
          className={`crm-button ${filters.length ? 'crm-button-active' : ''}`}
          aria-expanded={showFilter}
          onClick={() => setShowFilter(!showFilter)}
        >
          <FilterIcon size={14} />
          Filter{filters.length ? ` · ${filters.length}` : ''}
        </AppButton>
        <AppButton
          className="crm-button"
          aria-pressed={archived}
          onClick={() => {
            setArchived(!archived);
            setOffset(0);
          }}
        >
          <Archive size={14} />
          {archived ? 'Archived' : 'Archive'}
        </AppButton>
        {layout === 'board' && <BoardSettingsButton stages={groups.map(id => ({id, name:id || 'No status'}))} settings={boardPreferences.settings} onChange={value => void boardPreferences.save(value)} onAddStage={async name => {
          if (stageOptions.includes(name)) throw new Error('A stage with that name already exists.');
          await applyChange(`Add ${name} stage`, [{type:'update_collection',id:collection.id,version:collection.version,fields:collection.fields.map(f => f.key === groupBy ? {...f,options:[...(f.options || []),name]} : f)}]);
          await onChanged();
        }} error={boardPreferences.error}/>}
        <DropdownMenu>
          <ButtonTooltip label="Collection actions"><DropdownMenuTrigger className="crm-icon-button" aria-label="Collection actions"><MoreHorizontal size={18}/></DropdownMenuTrigger></ButtonTooltip>
          <DropdownMenuContent align="end" sideOffset={6} className="record-actions-menu">
            {Boolean(collection.views?.length) && <DropdownMenuGroup>
              <DropdownMenuLabel>Saved views</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={viewId} onValueChange={selectView}>
                {[{id:'all',name:'All records'}, ...(collection.views || [])].map(savedView => <DropdownMenuRadioItem key={savedView.id} value={savedView.id} closeOnClick>
                  {savedView.name}
                </DropdownMenuRadioItem>)}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator className="crm-menu-separator"/>
            </DropdownMenuGroup>}
            <DropdownMenuItem onClick={onSchema}><Settings2 size={14}/>Edit fields</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setViewEditor(true)}><Plus size={14}/>{view ? 'Edit view' : 'Save a view'}</DropdownMenuItem>
            <DropdownMenuItem onClick={onImport}><Upload size={14}/>Import JSON</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AppButton className="crm-button crm-button-primary crm-new-record" onClick={onNew}>
          <Plus size={16} />
          New record
        </AppButton>
      </section>
      {showFilter && (
        <div className="crm-filters">
          {filters.map((filter, index) => (
            <div key={index}>
              <NativeSelect
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
                <NativeSelectOption value="title">Title</NativeSelectOption>
                {collection.fields.map((f) => (
                  <NativeSelectOption key={f.key} value={f.key}>
                    {f.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <NativeSelect
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
                  <NativeSelectOption key={value} value={value}>
                    {label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              {!['empty', 'not_empty'].includes(filter.op) && (
                <Input
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
              <AppButton
                className="crm-icon-button"
                aria-label={`Remove filter ${index + 1}`}
                onClick={() => {
                  setFilters(filters.filter((_, i) => i !== index));
                  setOffset(0);
                }}
              >
                <X size={15} />
              </AppButton>
            </div>
          ))}
          <AppButton
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
          </AppButton>
          <Label>
            Sort
            <NativeSelect
              aria-label="Sort field"
              value={sort.field}
              onChange={(e) => {
                setSort({ ...sort, field: e.target.value });
                setOffset(0);
              }}
            >
              <NativeSelectOption value="updatedAt">Last updated</NativeSelectOption>
              <NativeSelectOption value="position">Pipeline order</NativeSelectOption>
              <NativeSelectOption value="createdAt">Created</NativeSelectOption>
              <NativeSelectOption value="title">Title</NativeSelectOption>
              {collection.fields.map((f) => (
                <NativeSelectOption key={f.key} value={f.key}>
                  {f.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <NativeSelect
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
            <NativeSelectOption value="asc">Ascending</NativeSelectOption>
            <NativeSelectOption value="desc">Descending</NativeSelectOption>
          </NativeSelect>
        </div>
      )}
      {error && (
        <p role="alert" className="crm-error">
          {error}
        </p>
      )}
      <div className="crm-records-viewport" aria-busy={loading}>
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
              <AppButton className="crm-button" onClick={onNew}>
                <Plus size={15} />
                Add a record
              </AppButton>
            )}
          </div>
        ) : layout === 'table' ? (
          // The scroll region is focusable so arrow/Page/End keys can scroll without opening a record.
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          <section className="crm-table-wrap" aria-label="Collection records" tabIndex={0}>
            <Table className="crm-table" containerClassName="crm-table-container">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">
                    Title <span>{data.total}</span>
                  </TableHead>
                  {visibleFields.map((field) => (
                    <TableHead scope="col" key={field.key}>
                      {field.name}
                    </TableHead>
                  ))}
                  <TableHead scope="col">Updated</TableHead><TableHead scope="col"><span className="sr-only">Actions</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.records.map((record) => (
                  <TableRow key={record.id}>
                    <TableHead scope="row">
                      <AppButton tooltip={`Open ${record.title}`} disabled={loading} onClick={() => onOpen(record)}>
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
                      </AppButton>
                    </TableHead>
                    {visibleFields.map((field) => {
                      const value = record.values[field.key];
                      return (
                        <TableCell key={field.key}>
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
                        </TableCell>
                      );
                    })}
                    <TableCell className="crm-muted">
                      {new Date(record.updatedAt).toLocaleDateString(
                        undefined,
                        { month: 'short', day: 'numeric' },
                      )}
                    </TableCell><TableCell className="crm-table-actions">{actions(record)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
        ) : groups.every(g => hiddenStages.includes(g)) ? (
          <div className="crm-empty"><h2>All stages are hidden.</h2><AppButton className="crm-button" onClick={() => void boardPreferences.save({...boardPreferences.settings, hiddenStages: []})}>Show all stages</AppButton></div>
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
                  <h2 title={name}>{name}</h2>
                  <span>
                    {
                      data.records.filter(
                        (r) => (r.values[groupBy] || '') === group,
                      ).length
                    }
                  </span>
                </header>
                {/* Keyboard users can scroll this column independently of its record buttons. */}
                {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
                <section className="crm-board-cards" aria-label={`${name} records`} tabIndex={0}>
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
                      onDrop={event => {
                        if (!dragged || archived || dragged.id === record.id) return;
                        event.preventDefault(); event.stopPropagation();
                        if (event.dataTransfer.getData('text/nextstep-record') === dragged.id) void move(dragged, group, record.id);
                        setDragged(null);
                      }}
                    >
                      <AppButton tooltip={`Open ${record.title}`} onClick={() => onOpen(record)} disabled={loading}>
                        <strong title={record.title}>{record.title}</strong>
                        {visibleFields
                          .filter(
                            (f) =>
                              f.key !== groupBy &&
                              record.values[f.key] != null &&
                              f.type !== 'relation',
                          )
                          .slice(0, view ? 4 : 2)
                          .map((f) => (
                            <span key={f.key} title={`${f.name}: ${displayValue(record.values[f.key])}`}>
                              <small>{f.name}</small>
                              {displayValue(record.values[f.key])}
                            </span>
                          ))}
                      </AppButton>
                      {actions(record)}
                    </article>
                  ))}
                </section>
              </section>
            ))}
          </div>
        )}
      </div>
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
        <AppButton
          className="crm-button"
          disabled={!offset || loading}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          Previous
        </AppButton>
        <AppButton
          className="crm-button"
          disabled={data.nextOffset === null || loading}
          onClick={() => setOffset(data.nextOffset!)}
        >
          Next
        </AppButton>
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
