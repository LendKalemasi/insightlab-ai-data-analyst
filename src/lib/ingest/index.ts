import { AppError } from '../errors';
import type { SourceKind } from '../types';
import { parseCsv } from './csv';
import { parseExcel } from './excel';
import { normalizeHeaders } from './headers';
import { normalizeColumn, type Cell, type NormalizedColumn } from './values';

export interface RawTable { headers: string[]; rows: Cell[][]; notes: string[] }

export interface IngestedTable {
  source: SourceKind;
  sheet: string | null;
  columns: NormalizedColumn[];
  rowCount: number;
  notes: string[];
}

export const ACCEPTED_EXTENSIONS = ['.csv', '.tsv', '.txt', '.xlsx'] as const;

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
const isOle = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;

/** Validates the file by extension *and* content, then parses and normalises it. */
export async function ingestFile(
  bytes: Uint8Array, fileName: string,
  limits: { maxRows: number; maxColumns: number },
  sheet?: string | null,
): Promise<IngestedTable> {
  const ext = (/\.[^.]+$/.exec(fileName.toLowerCase())?.[0] ?? '');
  if (!bytes.length) throw new AppError('EMPTY_FILE', 'The file is empty.', 400);

  if (ext === '.xls' || isOle(bytes)) {
    throw new AppError('UNSUPPORTED_TYPE', 'Legacy .xls workbooks are not supported. Open the file in Excel and save it as .xlsx or CSV.', 415);
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    if (!isZip(bytes)) throw new AppError('BAD_SPREADSHEET', 'The file has an .xlsx extension but is not an Excel workbook.', 400);
    const parsed = await parseExcel(bytes, limits, sheet);
    return finish(parsed, 'excel', parsed.sheet);
  }
  if (!(ACCEPTED_EXTENSIONS as readonly string[]).includes(ext)) {
    throw new AppError('UNSUPPORTED_TYPE', `"${ext || fileName}" files are not supported. Upload a CSV, TSV or Excel (.xlsx) file.`, 415);
  }
  if (isZip(bytes)) throw new AppError('UNSUPPORTED_TYPE', 'This looks like a compressed or Excel file, not CSV text. Rename it to .xlsx if it is a workbook.', 415);
  if (bytes.subarray(0, 4096).includes(0) && !(bytes[0] === 0xff || bytes[0] === 0xfe)) {
    throw new AppError('UNSUPPORTED_TYPE', 'The file contains binary data and is not a text CSV.', 415);
  }
  return finish(parseCsv(bytes, limits), 'csv', null);
}

export function finish(raw: RawTable, source: SourceKind, sheet: string | null): IngestedTable {
  if (!raw.rows.length) throw new AppError('NO_ROWS', 'The file has a header row but no data rows.', 400);
  const { names, notes: headerNotes } = normalizeHeaders(raw.headers.map((h) => String(h ?? '')));
  const columns = names.map((name, c) =>
    normalizeColumn(name, String(raw.headers[c] ?? '').trim() || name, raw.rows.map((row) => row[c])));
  return { source, sheet, columns, rowCount: raw.rows.length, notes: [...raw.notes, ...headerNotes] };
}
