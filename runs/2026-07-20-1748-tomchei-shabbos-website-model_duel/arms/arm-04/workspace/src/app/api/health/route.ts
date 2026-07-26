import { NextResponse } from 'next/server';

import { db } from '@/lib/db';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Green means the process booted with valid env AND can reach Postgres.
 * A reachable app with a dead database must not report healthy.
 */
export async function GET() {
  const startedAt = Date.now();

  try {
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    // Postgres connection errors quote the connection string, credentials and
    // all, so the detail goes to the server log and never to the caller.
    console.error('[health] database unreachable', error);
    return NextResponse.json(
      { status: 'error', database: 'unreachable', message: 'The database is unreachable.' },
      { status: 503 },
    );
  }

  return NextResponse.json({
    status: 'ok',
    database: 'ok',
    env: 'ok',
    authProvider: env.AUTH_PROVIDER,
    latencyMs: Date.now() - startedAt,
  });
}
