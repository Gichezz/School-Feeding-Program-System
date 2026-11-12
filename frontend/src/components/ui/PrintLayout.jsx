import { Printer } from 'lucide-react';
import Button from './Button';
import { todayDate } from '../../utils/format';

/**
 * The same "Print or save as PDF" button on every page that can be printed.
 */
export function PrintButton({ label = 'Print or save as PDF' }) {
  return (
    <Button variant="secondary" icon={Printer} onClick={() => window.print()} className="no-print">
      {label}
    </Button>
  );
}

/**
 * A heading that only appears on paper: what this is, for whom, and when it was
 * printed, so a printed page still makes sense on its own.
 *
 * title: e.g. "Analytics: schools to look at"
 * scope: e.g. "Mfano Sub-County · Term 3 2026 · figures up to 23-10-2026"
 */
export function PrintHeader({ title, scope }) {
  return (
    <div className="print-only ui-print-header">
      <p className="ui-print-header__title">Lishe · {title}</p>
      {scope && <p className="ui-print-header__scope">{scope}</p>}
      <p className="ui-print-header__date">Printed on {todayDate()}</p>
    </div>
  );
}
