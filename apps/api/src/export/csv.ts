export type CsvCell = string | number | null;

/** RFC 4180: quote when the value has `,` `"` `\r` or `\n`; double inner quotes; null → empty. */
export function csvCell(value: CsvCell): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  if (/[",\r\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

/** Header row + rows, each joined by `,`, lines by `\r\n`, with a trailing `\r\n`. */
export function toCsv(
  header: readonly string[],
  rows: readonly CsvCell[][],
): string {
  return [header, ...rows]
    .map((line) => `${line.map(csvCell).join(',')}\r\n`)
    .join('');
}
