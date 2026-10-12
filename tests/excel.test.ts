import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ingestFile } from '@/lib/ingest';

/** Builds a minimal but valid .xlsx workbook in memory (inline strings, numbers, one date-formatted cell). */
export function buildXlsx(sheets: Record<string, (string | number | null)[][]>, dateCells: string[] = []): Uint8Array {
  const names = Object.keys(sheets);
  const col = (i: number) => String.fromCharCode(65 + i);
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${names.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rIdS" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/></cellXfs></styleSheet>`),
  };
  names.forEach((name, s) => {
    const rows = sheets[name].map((row, r) => `<row r="${r + 1}">${row.map((v, c) => {
      const ref = `${col(c)}${r + 1}`;
      if (v === null) return '';
      if (typeof v === 'number') return `<c r="${ref}"${dateCells.includes(ref) ? ' s="1"' : ''}><v>${v}</v></c>`;
      return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    }).join('')}</row>`).join('');
    files[`xl/worksheets/sheet${s + 1}.xml`] = strToU8(`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows}</sheetData></worksheet>`);
  });
  return zipSync(files);
}

const limits = { maxRows: 1000, maxColumns: 50 };

describe('excel import', () => {
  it('reads the first non-empty sheet with numbers, text and dates', async () => {
    const xlsx = buildXlsx({
      Empty: [],
      Sales: [['Region', 'Revenue ($)', 'Day'], ['North', 120.5, 45658], ['South', 99, 45659]],
    }, ['C2', 'C3']);
    const t = await ingestFile(xlsx, 'report.xlsx', limits);
    expect(t.source).toBe('excel');
    expect(t.sheet).toBe('Sales');
    expect(t.columns.map((c) => [c.name, c.type])).toEqual([['Region', 'categorical'], ['Revenue', 'numeric'], ['Day', 'date']]);
    expect(t.columns[1].values).toEqual([120.5, 99]);
    expect(t.columns[2].values).toEqual(['2025-01-01', '2025-01-02']);
  });

  it('imports a named sheet and reports a missing one', async () => {
    const xlsx = buildXlsx({ A: [['x'], [1]], B: [['y'], [2]] });
    expect((await ingestFile(xlsx, 'b.xlsx', limits, 'B')).columns[0].name).toBe('y');
    await expect(ingestFile(xlsx, 'b.xlsx', limits, 'Nope')).rejects.toThrow(/no sheet named/);
  });

  it('rejects workbooks with no data and corrupt archives', async () => {
    await expect(ingestFile(buildXlsx({ S: [] }), 'e.xlsx', limits)).rejects.toThrow(/empty/i);
    const corrupt = buildXlsx({ S: [['a'], [1]] }).slice(0, 60);
    await expect(ingestFile(corrupt, 'c.xlsx', limits)).rejects.toThrow(/not a valid \.xlsx|could not be read/);
  });
});
