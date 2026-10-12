import { Parser } from 'node-sql-parser';

/**
 * Read-only SQL validation, used for user-written SQL and, as defence in
 * depth, for SQL generated from analysis specs.
 *
 * Layer 1 (always runs): strip comments, mask string literals and quoted
 * identifiers (so a column called "Last Update" is not mistaken for UPDATE),
 * reject statement stacking, non-SELECT statements and dangerous keywords.
 * Layer 2: node-sql-parser confirms the AST is a single SELECT.
 * Layer 3 (at execution): the SQLite connection is opened read-only with
 * `PRAGMA query_only`, so a write that slipped through would still fail.
 */
export interface SqlValidation {
  valid: boolean;
  sql: string;
  errors: string[];
  warnings: string[];
  limit_appended: boolean;
  parser_used: boolean;
}

const FORBIDDEN = /\b(insert|update|delete|drop|alter|create|truncate|merge|attach|detach|pragma|grant|revoke|vacuum|reindex|analyze|copy|load_extension|readfile|writefile|fts3_tokenizer|load_file)\b/i;

export function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

/** Replaces the contents of '…' literals and "…" / `…` / […] identifiers with placeholders. */
export function maskQuoted(sql: string): string {
  return sql
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`[^`]*`/g, '``')
    .replace(/\[[^\]]*\]/g, '[]');
}

/** Counts statements, ignoring semicolons inside literals and quoted identifiers. */
export function statementCount(sql: string): number {
  const masked = maskQuoted(sql).trim().replace(/;\s*$/, '');
  return masked.split(';').length;
}

export function validateSql(input: string, opts: { maxRows?: number; appendLimit?: boolean } = {}): SqlValidation {
  const { maxRows = 1000, appendLimit = true } = opts;
  const errors: string[] = [];
  const warnings: string[] = [];
  const hadComment = /--|\/\*/.test(maskQuoted(input));
  const stripped = stripComments(input);
  const normalized = stripped.trim().replace(/;\s*$/, '').trim();
  const masked = maskQuoted(normalized);

  if (!normalized) errors.push('The query is empty.');
  // After masking complete literals, any quote left over opens a literal that never closes.
  if (masked.replace(/''/g, '').includes("'")) errors.push('The query has an unterminated string literal.');
  if (statementCount(normalized) > 1) errors.push('Only one statement can be run at a time.');
  if (FORBIDDEN.test(masked) || /\breplace\s+into\b/i.test(masked) || /into\s+(out|dump)file/i.test(masked)) {
    errors.push('Only read-only SELECT queries are allowed. The query contains a keyword that modifies data or the database.');
  }
  if (normalized && !/^(select|with)\b/i.test(masked)) errors.push('The query must start with SELECT or WITH.');
  if (hadComment) warnings.push('Comments were removed before the query ran.');

  let parserUsed = false;
  if (!errors.length) {
    const ast = parseWithLibrary(normalized);
    if (ast) {
      parserUsed = true;
      if (!ast.isSelectOnly) errors.push('The SQL parser did not recognise this as a single read-only SELECT.');
    }
  }

  let sql = normalized;
  let limitAppended = false;
  if (!errors.length && appendLimit && !/\blimit\s+\d+/i.test(masked)) {
    sql = `${normalized}\nLIMIT ${maxRows}`;
    limitAppended = true;
  }
  return { valid: errors.length === 0, sql, errors, warnings, limit_appended: limitAppended, parser_used: parserUsed };
}

interface AstSummary { isSelectOnly: boolean }

/** Isolated so the parser can be swapped without touching callers. */
function parseWithLibrary(sql: string): AstSummary | null {
  try {
    const { ast, tableList } = new Parser().parse(sql, { database: 'sqlite' });
    const nodes = Array.isArray(ast) ? ast : [ast];
    return {
      isSelectOnly: nodes.length === 1 && (nodes[0] as { type?: string }).type === 'select'
        && tableList.every((t) => t.startsWith('select::')),
    };
  } catch {
    // The parser does not know every SQLite construct; layers 1 and 3 still apply.
    return null;
  }
}
