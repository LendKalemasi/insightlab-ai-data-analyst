/**
 * Two-layer read-only SQL validation.
 *
 * Layer 1 (always runs, no dependencies): normalise the statement, strip
 * comments, reject statement stacking and any non-SELECT leading keyword,
 * reject mutating/DDL/file/attach keywords, append a LIMIT.
 * Layer 2 (optional): node-sql-parser AST check confirming the statement
 * really is a single SELECT and reporting the tables it touches.
 *
 * Layer 1 is deliberately conservative: it is the fallback when the parser is
 * unavailable, and it runs even when the parser succeeds. Defence in depth
 * matters here because the parser is a third-party dependency.
 */
export interface SqlValidation {
  valid: boolean;
  normalized_sql: string;
  errors: string[];
  warnings: string[];
  tables_referenced: string[];
  columns_referenced: string[];
  estimated_risk: 'low' | 'medium' | 'high';
  parser_used: boolean;
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|replace|merge|attach|detach|pragma|grant|revoke|vacuum|reindex|copy|load_extension|readfile|writefile|load_file)\b/i;
const OUTFILE = /into\s+(out|dump)file/i;

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Splits on `;` that are not inside string literals. */
export function statementCount(sql: string): number {
  let count = 1, inStr = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    if (c === "'") { if (inStr && sql[i + 1] === "'") i++; else inStr = !inStr; }
    else if (c === ';' && !inStr) count++;
  }
  return count;
}

export function validateSql(sql: string, maxRows = 1000): SqlValidation {
  const errors: string[] = [], warnings: string[] = [];
  const hadComment = /--|\/\*/.test(sql);
  const stripped = stripComments(sql);
  if (hadComment) warnings.push('SQL comments were stripped before validation so they cannot mask rejected keywords.');

  const normalized = stripped.replace(/\s+/g, ' ').trim().replace(/;\s*$/, '');
  if (!normalized) errors.push('The statement is empty after removing comments.');
  if (statementCount(normalized) > 1) errors.push('Multiple statements are not allowed; submit a single SELECT.');
  if (FORBIDDEN.test(normalized) || OUTFILE.test(normalized)) {
    errors.push('Only read-only statements are permitted. A mutating, DDL, or file-access keyword was found.');
  }
  if (!/^(select|with)\b/i.test(normalized)) errors.push('The statement must begin with SELECT or WITH.');
  if (/^with\b/i.test(normalized) && !/\bselect\b/i.test(normalized)) {
    errors.push('A WITH clause must ultimately perform a SELECT.');
  }

  let tables: string[] = [], columns: string[] = [], parserUsed = false;
  if (!errors.length) {
    const ast = parseWithLibrary(normalized);
    if (ast) {
      parserUsed = true;
      if (!ast.isSelectOnly) errors.push('The SQL parser did not classify this statement as a single SELECT.');
      tables = ast.tables; columns = ast.columns;
    } else {
      warnings.push('The SQL parser was unavailable; the conservative keyword validator was used alone.');
    }
  }

  let out = normalized;
  if (!errors.length && !/\blimit\b/i.test(normalized)) {
    out = `${normalized} LIMIT ${maxRows}`;
    warnings.push(`An automatic LIMIT ${maxRows} was appended.`);
  }
  return {
    valid: errors.length === 0, normalized_sql: out, errors, warnings,
    tables_referenced: tables, columns_referenced: columns,
    estimated_risk: errors.length ? 'high' : warnings.length > 1 ? 'medium' : 'low',
    parser_used: parserUsed,
  };
}

interface AstSummary { isSelectOnly: boolean; tables: string[]; columns: string[] }

/** Isolated so the parser dependency can be swapped or removed without touching callers. */
function parseWithLibrary(sql: string): AstSummary | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Parser } = require('node-sql-parser') as typeof import('node-sql-parser');
    const parser = new Parser();
    const { tableList, columnList, ast } = parser.parse(sql, { database: 'sqlite' });
    const nodes = Array.isArray(ast) ? ast : [ast];
    const isSelectOnly = nodes.length === 1 && nodes.every((n) => (n as { type?: string }).type === 'select')
      && tableList.every((t) => t.startsWith('select::'));
    return {
      isSelectOnly,
      tables: [...new Set(tableList.map((t) => t.split('::').pop() ?? t))],
      columns: [...new Set(columnList.map((c) => c.split('::').pop() ?? c))],
    };
  } catch {
    return null;
  }
}
