import {NextResponse} from 'next/server';
import {clearSessionCookie, getSessionClaims, revokeAllSessions} from '@/lib/auth';
import {logAuthEvent} from '@/lib/logger';

/** Invalidate every session for this account (other devices included). */
export async function POST() {
  const claims = await getSessionClaims();
  if (!claims) {
    await clearSessionCookie();
    return NextResponse.json({ok: true});
  }
  await revokeAllSessions(claims.id);
  await clearSessionCookie();
  logAuthEvent('logout_all', {userId: claims.id});
  return NextResponse.json({ok: true});
}
