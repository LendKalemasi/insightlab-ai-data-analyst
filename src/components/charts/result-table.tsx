'use client';
import { Download } from 'lucide-react';
import { formatNumber } from '@/lib/format';
import type { TableResult } from '@/lib/types';
import { Button, cx } from '../ui';
import { downloadText, safeFileName, toCsv } from './export';

/** Read-only result grid used by analysis answers and the SQL editor. */
export function ResultTable({ result, fileName, maxHeight = 360 }: { result: TableResult; fileName: string; maxHeight?: number }) {
  const cols = result.columns;
  if (!result.rows.length) return <p className="py-6 text-center text-sm text-muted">The query returned no rows.</p>;
  return (
    <div>
      <div className="overflow-auto rounded-md border border-line scroll-thin" style={{ maxHeight }} tabIndex={0} aria-label="Result table">
        <table className="w-full border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-sunken">
            <tr>{cols.map((c) => <th key={c.name} scope="col" className={cx('whitespace-nowrap border-b border-line px-3 py-2 text-xs font-medium text-muted', c.kind === 'number' ? 'text-right' : 'text-left')}>{c.name}</th>)}</tr>
          </thead>
          <tbody>
            {result.rows.map((r, i) => (
              <tr key={i} className="hover:bg-sunken/60">
                {cols.map((c) => {
                  const v = r[c.name];
                  const missing = v === null || v === undefined || v === '';
                  return (
                    <td key={c.name} className={cx('max-w-[320px] truncate whitespace-nowrap border-b border-line px-3 py-1.5', c.kind === 'number' && 'text-right num')} title={missing ? 'Missing' : String(v)}>
                      {missing ? <span className="text-subtle" aria-label="missing">—</span> : typeof v === 'number' ? formatNumber(v, 4) : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span className="num">{result.row_count.toLocaleString('en-US')} row{result.row_count === 1 ? '' : 's'}{result.truncated ? ' (truncated at the row limit)' : ''}</span>
        <Button size="sm" variant="ghost" icon={<Download className="h-3.5 w-3.5" aria-hidden />}
          onClick={() => downloadText(toCsv(cols.map((c) => c.name), result.rows), `${safeFileName(fileName)}.csv`, 'text/csv')}>
          Download CSV
        </Button>
      </div>
    </div>
  );
}
