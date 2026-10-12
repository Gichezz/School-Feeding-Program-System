/**
 * CSV export for Reports. Opens directly in Excel or Google Sheets.
 */

function csvCell(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * columns: [{ header, value(row) }]
 */
export function toCsv(rows, columns) {
  const lines = [columns.map((column) => csvCell(column.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((column) => csvCell(column.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Save text as a file through the browser's normal download.
 */
export function downloadFile(filename, text, type = 'text/csv;charset=utf-8') {
  // The byte-order mark makes Excel read the file as UTF-8
  const blob = new Blob(['﻿', text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
