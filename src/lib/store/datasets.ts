import 'server-only';
import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { AppError } from '../errors';
import type { IngestedTable } from '../ingest';
import { countDuplicateRows, profileColumn, qualityIssues } from '../profile';
import { quoteIdent } from '../query/sql';
import type { DatasetInfo, DatasetSummary, SourceKind } from '../types';

/**
 * Disk-backed dataset store.
 *
 * Each dataset lives in its own directory under DATA_DIR:
 *   data.sqlite   – one table, `dataset`, opened read-only for every query
 *   meta.json     – schema, cached column profiles and quality findings
 *   analyses.json – the saved analysis conversation (see ./analyses.ts)
 *
 * Datasets are deleted automatically after DATASET_RETENTION_HOURS, when the
 * MAX_DATASETS cap is exceeded, or when the user deletes them. Ids are
 * unguessable random tokens; there is no listing endpoint, so a dataset can
 * only be reached by someone who holds its id.
 */

const ID_PATTERN = /^ds_[a-f0-9]{32}$/;
const MAX_OPEN_HANDLES = 8;

export interface DatasetHandle { info: DatasetInfo; db: Database.Database }

const handles = new Map<string, Database.Database>();
let lastSweep = 0;

export function isDatasetId(id: string): boolean {
  return ID_PATTERN.test(id);
}

/** The only place a dataset id becomes a filesystem path, and only after validation. */
export function datasetDir(id: string): string {
  if (!isDatasetId(id)) throw new AppError('NOT_FOUND', 'Dataset not found.', 404);
  return path.join(config.dataDir, id);
}

function writeJsonAtomic(file: string, value: unknown): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function createDataset(
  table: IngestedTable,
  meta: { name: string; fileName: string | null; fileBytes: number | null },
): DatasetInfo {
  sweep(true);
  const id = `ds_${randomUUID().replace(/-/g, '')}`;
  const dir = datasetDir(id);
  fs.mkdirSync(dir, { recursive: true });

  try {
    const db = new Database(path.join(dir, 'data.sqlite'));
    db.pragma('journal_mode = OFF');
    db.pragma('synchronous = OFF');
    const cols = table.columns.map((c) => `${quoteIdent(c.name)} ${c.type === 'numeric' ? 'REAL' : 'TEXT'}`).join(', ');
    db.exec(`CREATE TABLE dataset (${cols})`);
    const insert = db.prepare(`INSERT INTO dataset VALUES (${table.columns.map(() => '?').join(', ')})`);
    const insertAll = db.transaction(() => {
      const row = new Array(table.columns.length);
      for (let r = 0; r < table.rowCount; r++) {
        for (let c = 0; c < table.columns.length; c++) row[c] = table.columns[c].values[r];
        insert.run(row);
      }
    });
    insertAll();
    db.close();

    const columns = table.columns.map(profileColumn);
    const duplicateRows = countDuplicateRows(table.columns, table.rowCount);
    const now = new Date();
    const info: DatasetInfo = {
      id,
      name: meta.name,
      source: table.source as SourceKind,
      file_name: meta.fileName,
      sheet: table.sheet,
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + config.retentionHours * 3_600_000).toISOString(),
      row_count: table.rowCount,
      column_count: columns.length,
      file_bytes: meta.fileBytes,
      missing_cells: columns.reduce((s, c) => s + c.missing, 0),
      duplicate_rows: duplicateRows,
      columns,
      quality: qualityIssues(columns, table.rowCount, duplicateRows),
      ingest_notes: table.notes,
    };
    writeJsonAtomic(path.join(dir, 'meta.json'), info);
    return info;
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

function readInfo(id: string): DatasetInfo | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(datasetDir(id), 'meta.json'), 'utf8')) as DatasetInfo;
  } catch {
    return null;
  }
}

const expired = (info: DatasetInfo) => Date.parse(info.expires_at) <= Date.now();

export function getDatasetInfo(id: string): DatasetInfo {
  sweep();
  const info = isDatasetId(id) ? readInfo(id) : null;
  if (!info || expired(info)) {
    throw new AppError('NOT_FOUND', 'This dataset no longer exists. Datasets are deleted automatically after the retention period — upload the file again to continue.', 404);
  }
  return info;
}

export function openDataset(id: string): DatasetHandle {
  const info = getDatasetInfo(id);
  let db = handles.get(id);
  if (db) {
    handles.delete(id); // re-insert to mark as most recently used
  } else {
    db = new Database(path.join(datasetDir(id), 'data.sqlite'), { readonly: true, fileMustExist: true });
    db.pragma('query_only = true');
  }
  handles.set(id, db);
  while (handles.size > MAX_OPEN_HANDLES) {
    const [oldest, handle] = handles.entries().next().value as [string, Database.Database];
    handle.close();
    handles.delete(oldest);
  }
  return { info, db };
}

function closeHandle(id: string): void {
  const db = handles.get(id);
  if (db) { try { db.close(); } catch { /* already closed */ } handles.delete(id); }
}

export function deleteDataset(id: string): void {
  const dir = datasetDir(id);
  closeHandle(id);
  fs.rmSync(dir, { recursive: true, force: true });
}

export function summarize(info: DatasetInfo): DatasetSummary {
  return {
    id: info.id, name: info.name, source: info.source, created_at: info.created_at,
    expires_at: info.expires_at, row_count: info.row_count, column_count: info.column_count,
  };
}

/** Looks up datasets the browser already knows about. Unknown or expired ids are simply absent. */
export function findDatasets(ids: string[]): DatasetSummary[] {
  sweep();
  return ids.filter(isDatasetId).map(readInfo).filter((i): i is DatasetInfo => !!i && !expired(i)).map(summarize);
}

/** Deletes expired datasets, orphaned directories, and the oldest datasets beyond MAX_DATASETS. */
export function sweep(force = false): void {
  const now = Date.now();
  if (!force && now - lastSweep < 60_000) return;
  lastSweep = now;
  let entries: string[];
  try { entries = fs.readdirSync(config.dataDir); } catch { fs.mkdirSync(config.dataDir, { recursive: true }); return; }

  const live: DatasetInfo[] = [];
  for (const name of entries) {
    if (!isDatasetId(name)) continue;
    const info = readInfo(name);
    if (info && !expired(info)) { live.push(info); continue; }
    // A directory without metadata may be an import in progress; give it an hour.
    const dir = path.join(config.dataDir, name);
    const age = (() => { try { return now - fs.statSync(dir).mtimeMs; } catch { return 0; } })();
    if (info || age > 3_600_000) { closeHandle(name); fs.rmSync(dir, { recursive: true, force: true }); }
  }
  live.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  // A forced sweep runs right before an import, so it leaves room for one more.
  const cap = force ? config.maxDatasets - 1 : config.maxDatasets;
  while (live.length > cap) {
    const oldest = live.shift()!;
    deleteDataset(oldest.id);
  }
}
