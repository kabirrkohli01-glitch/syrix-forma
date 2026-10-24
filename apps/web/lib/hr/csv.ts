/**
 * CSV serialisation for HR exports.
 *
 * Hand-rolled rather than pulled from a package because the requirement is one function and
 * the dependency would need a DEPENDENCIES.md entry for less code than this file contains.
 * The two things a CSV writer has to get right are both handled here: quoting, and formula
 * injection.
 */

/**
 * Characters that make a spreadsheet treat a cell as a formula rather than text.
 *
 * A field beginning with one of these is prefixed with a single quote on export. Without it, a
 * value like `=cmd|'/c calc'!A1` — which an attacker can get into the system simply by naming
 * themselves that — executes when the exported file is opened. The exported data here comes
 * from employee-supplied fields (names, expense descriptions, notes), so this is a real path,
 * not a theoretical one.
 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

function escapeCell(value: string): string {
  let cell = value;

  if (cell.length > 0 && FORMULA_PREFIXES.has(cell[0])) {
    cell = `'${cell}`;
  }

  // Quote when the value contains a delimiter, a quote, or a newline; double any quotes
  // inside. RFC 4180.
  if (/[",\n\r]/u.test(cell)) {
    cell = `"${cell.replaceAll('"', '""')}"`;
  }

  return cell;
}

export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const lines = [headers.map((header) => escapeCell(header)).join(',')];

  for (const row of rows) {
    lines.push(
      row
        .map((cell) => escapeCell(cell === null || cell === undefined ? '' : String(cell)))
        .join(',')
    );
  }

  // CRLF per RFC 4180, and a trailing newline so the last row is terminated like the rest.
  return `${lines.join('\r\n')}\r\n`;
}
