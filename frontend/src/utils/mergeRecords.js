/**
 * Combine records stored on this device with records from the server for display.
 * A server record is left out when the device already has the same record, matched by
 * the stored server id, or by school and date (the server allows one record per school
 * per date). Records synced before the server id was stored match on school and date.
 * Local records come first and take precedence.
 *
 * @param {object[]} localRecords records from IndexedDB (camelCase fields)
 * @param {object[]} serverRecords records from the API (snake_case fields)
 * @param {{ localDateField: string, serverDateField: string }} fields
 */
export function mergeLocalAndServerRecords(localRecords, serverRecords, { localDateField, serverDateField }) {
  const serverIds = new Set(localRecords.map((record) => record.serverId).filter(Boolean));
  const schoolDateKeys = new Set(
    localRecords.map((record) => `${record.schoolId}|${record[localDateField]}`)
  );

  const serverOnly = serverRecords.filter(
    (record) =>
      !serverIds.has(record.id) &&
      !schoolDateKeys.has(`${record.school_id}|${record[serverDateField]}`)
  );

  return [...localRecords, ...serverOnly];
}
