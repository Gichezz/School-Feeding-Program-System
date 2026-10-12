import { CloudOff } from 'lucide-react';
import Badge from './Badge';
import EmptyState from './EmptyState';
import Skeleton, { LoadingRegion } from './Skeleton';

/**
 * Table on tablet/desktop, card list on mobile.
 *
 * columns: [{ key, header, render?(row), align?: 'start' | 'end', primary?: true }]
 *   The `primary` column becomes the heading of each card on mobile.
 * isUnsynced(row): mark records that only exist on this device.
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
}) {
  const primary = columns.find((column) => column.primary) || columns[0];
  const secondary = columns.filter((column) => column !== primary);
  const cell = (column, row) => (column.render ? column.render(row) : row[column.key]);
  const unsyncedBadge = (
    <Badge tone="warning" icon={CloudOff} className="ui-table__unsynced">Not yet synced</Badge>
  );

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

  return (
    <div className="ui-table">
      <div className="ui-table__scroll">
        <table className="ui-table__table">
          {caption && <caption className="visually-hidden">{caption}</caption>}
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={column.align === 'end' ? 'ui-table__cell--end' : undefined}>
                  {column.header}
                </th>
              ))}
              {isUnsynced && <th scope="col"><span className="visually-hidden">Sync</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={getRowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.align === 'end' ? 'ui-table__cell--end' : undefined}>
                    {cell(column, row)}
                  </td>
                ))}
                {isUnsynced && <td className="ui-table__cell--badge">{isUnsynced(row) && unsyncedBadge}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="ui-table__list" aria-label={caption}>
        {rows.map((row) => (
          <li key={getRowKey(row)} className="ui-table__item">
            <div className="ui-table__item-head">
              <span className="ui-table__item-title">{cell(primary, row)}</span>
              {isUnsynced?.(row) && unsyncedBadge}
            </div>
            <dl className="ui-table__item-fields">
              {secondary.map((column) => (
                <div key={column.key} className="ui-table__item-field">
                  <dt>{column.header}</dt>
                  <dd>{cell(column, row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default DataTable;
