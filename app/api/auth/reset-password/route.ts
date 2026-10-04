import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {revokeAllSessions} from '@/lib/auth';
import {hashPassword} from '@/lib/password';
import {logAuthEvent} from '@/lib/logger';
import {consumeAuthToken} from '@/lib/tokens';
import {clientIp, reset} from '@/lib/rate-limit';

export async function POST(req: NextRequest) {
  let body: {token?: unknown; password?: unknown};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }

  const token = String(body.token ?? '');
  const password = String(body.password ?? '');
  if (password.length < 8 || password.length > 200) {
    return NextResponse.json({error: 'Password must be at least 8 characters'}, {status: 400});
  }

  const claimed = await consumeAuthToken(token, 'RESET_PASSWORD');
  if (!claimed) {
    return NextResponse.json({error: 'This reset link is invalid or has expired'}, {status: 400});
  }

  const user = claimed.userId
    ? await prisma.user.findUnique({where: {id: claimed.userId}})
    : await prisma.user.findUnique({where: {email: claimed.email}});
  if (!user) return NextResponse.json({error: 'This reset link is invalid or has expired'}, {status: 400});

  const passwordHash = await hashPassword(password);
  await prisma.user.update({where: {id: user.id}, data: {passwordHash}});
  // Every existing session (including the one that requested the reset) is now invalid.
  await revokeAllSessions(user.id);
  reset(`login:fail:${user.email}`);

  logAuthEvent('password_reset_completed', {userId: user.id, email: user.email, ip: clientIp(req.headers)});
  return NextResponse.json({ok: true});
}
