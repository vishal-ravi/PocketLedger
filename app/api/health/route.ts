import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';

/** Uptime-monitor / load-balancer probe. Public on purpose. */
export async function GET() {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }
  const ok = db === 'up';
  return NextResponse.json(
    {status: ok ? 'ok' : 'degraded', db, uptime: Math.round(process.uptime()), time: new Date().toISOString()},
    {status: ok ? 200 : 503, headers: {'cache-control': 'no-store'}},
  );
}
