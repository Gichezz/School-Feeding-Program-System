import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { formatNumber } from '../../utils/format';
import { lowOnFood } from './analyticsData';

const days = (n) => (n === 0 ? 'none' : formatNumber(n));

/**
 * Cereals in each school's store and how many school days they last, against the school
 * days left in the term. One row per school, fewest days first; a school that will run
 * out before the term ends says so in words, with an icon, as well as in colour. Once a
 * term has closed nothing is marked: the store is what the school carries into next term.
 *
 * schools: term analytics rows (cerealsInStoreKg, daysOfFood, schoolDaysLeft)
 */
function StockTable({ schools, caption, limit }) {
  const rows = schools
    .filter((s) => s.daysOfFood !== null && s.daysOfFood !== undefined)
    .sort((a, b) => a.daysOfFood - b.daysOfFood || a.name.localeCompare(b.name))
    .slice(0, limit);
  const termOpen = rows.some((s) => s.schoolDaysLeft > 0);

  return (
    <div className="stock-table">
      <table className="stock-table__table">
        <caption className="visually-hidden">{caption}</caption>
        <thead>
          <tr>
            <th scope="col">School</th>
            <th scope="col" className="stock-table__num">In store</th>
            <th scope="col" className="stock-table__num">School days of food</th>
            {termOpen && <th scope="col" className="stock-table__num">School days left</th>}
            <th scope="col"><span className="visually-hidden">Compared with the days left</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const short = lowOnFood(s);
            // The bar shows how much of what the term still needs is in the store
            const share = s.schoolDaysLeft > 0 ? Math.min(s.daysOfFood / s.schoolDaysLeft, 1) : Math.min(s.daysOfFood / 20, 1);
            return (
              <tr key={s.schoolId} className={short ? 'stock-table__row--short' : undefined}>
                <th scope="row"><Link to={`/schools/${s.schoolId}`}>{s.name}</Link></th>
                <td className="stock-table__num">{s.cerealsInStoreKg === null ? '–' : `${formatNumber(Math.max(s.cerealsInStoreKg, 0))} kg`}</td>
                <td className="stock-table__num">
                  {short && <AlertTriangle className="stock-table__icon" aria-hidden="true" />}
                  {days(s.daysOfFood)}
                  {short && <span className="visually-hidden"> (runs out before the term ends)</span>}
                </td>
                {termOpen && <td className="stock-table__num">{formatNumber(s.schoolDaysLeft)}</td>}
                <td><progress className="stock-table__bar" max="1" value={share} aria-hidden="true" tabIndex={-1} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default StockTable;
