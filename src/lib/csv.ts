import { AppError } from './errors';

export interface ParsedCsv {
  columns: string[];
  rows: Record<string, string>[];
  delimiter: string;
  renamed_columns: string[];
}

const CANDIDATES = [',', ';', '\t', '|'];
const MAX_COLUMNS = 200;
const MAX_ROWS = 100_000;
const MAX_CELL_LENGTH = 100_000;
const SAFE_COLUMN_NAME = /^[A-Za-z_][A-Za-z0-9_ ]*$/;

export function detectDelimiter(firstLine: string): string {
  let best = ',', bestCount = 0;
  for (const d of CANDIDATES) {
    const n = firstLine.split(d).length;
    if (n > bestCount) { bestCount = n; best = d; }
  }
  return best;
}

/** RFC4180-style parser: handles quoted fields, embedded delimiters and "" escapes. */
export function parseCsv(text: string): ParsedCsv {
  const clean = text.replace(/^\uFEFF/, '');
  if (!clean.trim()) throw new AppError('CSV_EMPTY', 'The uploaded file is empty.', 400);

  const delimiter = detectDelimiter(clean.split(/\r?\n/)[0] ?? '');
  const records: string[][] = [];
  let field = '', record: string[] = [], quoted = false;

  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { record.push(field); field = ''; }
    else if (c === '\n') { record.push(field); records.push(record); record = []; field = ''; }
    else if (c !== '\r') field += c;
    if (field.length > MAX_CELL_LENGTH) throw new AppError('CSV_CELL_TOO_LARGE', 'A CSV cell exceeds the supported size limit.', 413);
    if (record.length > MAX_COLUMNS) throw new AppError('CSV_TOO_MANY_COLUMNS', 'The CSV contains too many columns.', 413);
    if (records.length > MAX_ROWS + 1) throw new AppError('CSV_TOO_MANY_ROWS', 'The CSV contains too many rows.', 413);
  }
  if (quoted) throw new AppError('CSV_MALFORMED', 'The CSV contains an unterminated quoted field.', 400);
  if (field !== '' || record.length) { record.push(field); records.push(record); }

  const header = records.shift();
  if (!header || header.every((h) => !h.trim())) {
    throw new AppError('CSV_NO_HEADER', 'No header row was detected. The first line must contain column names.', 400);
  }
  if (header.length > MAX_COLUMNS) throw new AppError('CSV_TOO_MANY_COLUMNS', 'The CSV contains too many columns.', 413);

  const seen = new Map<string, number>();
  const renamed: string[] = [];
  const columns = header.map((h, i) => {
    const base = h.trim() || `column_${i + 1}`;
    if (!SAFE_COLUMN_NAME.test(base)) {
      throw new AppError('CSV_INVALID_HEADER', `Column "${base}" contains unsupported characters. Use letters, numbers, underscores, and spaces; the first character must be a letter or underscore.`, 400);
    }
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    if (count > 1) { renamed.push(base); return `${base}_${count}`; }
    return base;
  });

  const rows = records
    .filter((r) => r.some((v) => v !== ''))
    .map((r) => Object.fromEntries(columns.map((c, i) => [c, (r[i] ?? '').trim()])));

  if (!rows.length) throw new AppError('CSV_NO_ROWS', 'The file has a header row but no data rows.', 400);
  return { columns, rows, delimiter, renamed_columns: renamed };
}
