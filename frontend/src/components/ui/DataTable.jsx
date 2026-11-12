import { useId, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, CloudOff, Search } from 'lucide-react';
import Badge from './Badge';
import Button from './Button';
import EmptyState from './EmptyState';
import FilterChips from './FilterChips';
import Skeleton, { LoadingRegion } from './Skeleton';
import { filterRows, resultText, searchRows, sortRows } from './tableData';

/**
 * Table on tablet/desktop, card list on mobile.
 *
 * columns: [{
 *   key, header, render?(row), align?: 'start' | 'end',
 *   primary?: true,            // the heading of each card on mobile
 *   action?: true,             // buttons: a full-width row at the foot of each mobile card
 *   sortValue?(row)            // makes the column sortable by this value
 * }]
 * isUnsynced(row): mark records that only exist on this device.
 *
 * Optional, all on rows already loaded (nothing calls the server):
 * search: { label, textOf(row) => string[] }
 * filters: [{ key, label, options: [{ value, label }], matches(row, value) }]
 * noun: what the rows are, for the result count ("12 of 40 schools")
 * stickyFirstColumn: keep the first column in view when the table scrolls sideways
 * pageSize: show this many rows, then "Show more"
 */
function DataTable({
  columns,
  rows,
  getRowKey = (row) => row.id,
  isUnsynced,
  caption,
  emptyState = { title: 'Nothing to show yet' },
  loading = false,
  skeletonRows = 3,
  search,
  filters,
  noun = 'rows',
  stickyFirstColumn = false,
  pageSize,
  initialSort,
}) {
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState({});
  const [sort, setSort] = useState(initialSort || null); // { key, direction }
  const [limit, setLimit] = useState(pageSize);

  const primary = columns.find((column) => column.primary) || columns[0];
  const actionColumns = columns.filter((column) => column.action);
  const secondary = columns.filter((column) => column !== primary && !column.action);
  const cell = (column, row) => (column.render ? column.render(row) : row[column.key]);
  const unsyncedBadge = (
    <Badge tone="warning" icon={CloudOff} className="ui-table__unsynced">Not sent yet</Badge>
  );

  const shownRows = useMemo(() => {
    let result = rows || [];
    if (search) result = searchRows(result, query, search.textOf);
    if (filters) result = filterRows(result, filters, chosen);
    const sortColumn = sort && columns.find((column) => column.key === sort.key);
    if (sortColumn?.sortValue) result = sortRows(result, sortColumn.sortValue, sort.direction);
    return result;
  }, [rows, search, query, filters, chosen, sort, columns]);

  if (loading) {
    return (
      <LoadingRegion label={caption ? `Loading ${caption}` : 'Loading'}>
        <div className="ui-table-skeleton">
          {Array.from({ length: skeletonRows }, (_, i) => <Skeleton key={i} variant="row" />)}
        </div>
      </LoadingRegion>
    );
  }

  if (!rows || rows.length === 0) {
    return <EmptyState compact {...emptyState} />;
  }

  const hasControls = Boolean(search || filters);
  const visibleRows = limit ? shownRows.slice(0, limit) : shownRows;
  const narrowed = shownRows.length !== rows.length;

  const toggleSort = (key) => {
    setSort((current) => {
      if (!current || current.key !== key) return { key, direction: 'ascending' };
      return { key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' };
    });
  };

  const headerCell = (column, index) => {
    const sorted = sort?.key === column.key ? sort.direction : undefined;
    const SortIcon = sorted === 'ascending' ? ArrowUp : sorted === 'descending' ? ArrowDown : ArrowUpDown;
    const className = [
      column.align === 'end' && 'ui-table__cell--end',
      stickyFirstColumn && index === 0 && 'ui-table__cell--sticky',
    ].filter(Boolean).join(' ') || undefined;
    return (
      <th key={column.key} scope="col" className={className} aria-sort={column.sortValue ? (sorted || 'none') : undefined}>
        {column.sortValue ? (
          <button type="button" className="ui-table__sort" onClick={() => toggleSort(column.key)}>
            {column.header}
            <SortIcon className="ui-table__sort-icon" aria-hidden="true" />
          </button>
        ) : column.header}
      </th>
    );
  };

  return (
    <div className={`ui-table ${stickyFirstColumn ? 'ui-table--sticky' : ''}`.trim()}>
      {hasControls && (
        <div className="ui-table__controls">
          {search && (
            <div className="ui-table__search">
              <label htmlFor={searchId} className="ui-field__label">{search.label}</label>
              <div className="ui-table__search-box">
                <Search className="ui-table__search-icon" aria-hidden="true" />
                <input id={searchId} type="search" className="ui-field__control" value={query}
                  onChange={(e) => { setQuery(e.target.value); setLimit(pageSize); }} />
              </div>
            </div>
          )}
          {filters && (
            <FilterChips groups={filters} value={chosen} onChange={(next) => { setChosen(next); setLimit(pageSize); }}
              resultText={resultText(shownRows.length, rows.length, noun)} />
          )}
          {!filters && search && narrowed && (
            <p className="ui-filters__result" role="status" aria-atomic="true">{resultText(shownRows.length, rows.length, noun)}</p>
          )}
        </div>
      )}

      {shownRows.length === 0 ? (
        <EmptyState compact title={`No ${noun} match`} description="Try other words, or clear the filters." />
      ) : (
        <>
          <div className="ui-table__scroll">
            <table className="ui-table__table">
              {caption && <caption className="visually-hidden">{caption}</caption>}
              <thead>
                <tr>
                  {columns.map(headerCell)}
                  {isUnsynced && <th scope="col"><span className="visually-hidden">Sync</span></th>}
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={getRowKey(row)}>
                    {columns.map((column, index) => {
                      const className = [
                        column.align === 'end' && 'ui-table__cell--end',
                        column.action && 'ui-table__cell--action',
                        stickyFirstColumn && index === 0 && 'ui-table__cell--sticky',
                      ].filter(Boolean).join(' ') || undefined;
                      return <td key={column.key} className={className}>{cell(column, row)}</td>;
                    })}
                    {isUnsynced && <td className="ui-table__cell--badge">{isUnsynced(row) && unsyncedBadge}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="ui-table__list" aria-label={caption}>
            {visibleRows.map((row) => (
              <li key={getRowKey(row)} className="ui-table__item">
                <div className="ui-table__item-head">
                  <span className="ui-table__item-title">{cell(primary, row)}</span>
                  {isUnsynced?.(row) && unsyncedBadge}
                </div>
                {secondary.length > 0 && (
                  <dl className="ui-table__item-fields">
                    {secondary.map((column) => (
                      <div key={column.key} className="ui-table__item-field">
                        <dt>{column.header}</dt>
                        <dd>{cell(column, row)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {actionColumns.length > 0 && (
                  <div className="ui-table__item-actions">
                    {actionColumns.map((column) => <div key={column.key}>{cell(column, row)}</div>)}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {limit && shownRows.length > limit && (
            <div className="ui-table__more">
              <Button variant="secondary" onClick={() => setLimit((n) => n + pageSize)}>
                Show more ({shownRows.length - limit} more)
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default DataTable;
