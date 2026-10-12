import { NextResponse } from 'next/server';
import { appStatus, logConfigOnce } from '@/lib/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Public configuration summary for the UI. Contains no secrets. */
export function GET() {
  logConfigOnce();
  return NextResponse.json(appStatus());
}
