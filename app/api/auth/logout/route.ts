import {NextResponse} from 'next/server';
import {clearSessionCookie, getSessionClaims} from '@/lib/auth';
import {logAuthEvent} from '@/lib/logger';

export async function POST() {
  const claims = await getSessionClaims();
  await clearSessionCookie();
  if (claims) logAuthEvent('logout', {userId: claims.id});
  return NextResponse.json({ok: true});
}
