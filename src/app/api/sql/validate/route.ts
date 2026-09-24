import { NextResponse } from 'next/server';
import { ValidateSqlRequest } from '@/lib/types';
import { validateSql } from '@/lib/sql-validator';
import { toErrorResponse } from '@/lib/errors';
import { MAX_QUERY_ROWS } from '@/lib/limits';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { sql } = ValidateSqlRequest.parse(await req.json());
    return NextResponse.json(validateSql(sql, MAX_QUERY_ROWS));
  } catch (e) { return toErrorResponse(e); }
}
