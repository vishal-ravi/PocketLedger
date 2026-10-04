import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {createTwoFactorChallenge, setSessionCookie} from '@/lib/auth';
import {verifyPassword} from '@/lib/password';
import {clientIp, failHit, hit, isLocked, reset} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';

const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 15 * 60_000;
const LOCK_MS = 15 * 60_000;

function tooMany(retryAfter: number): NextResponse {
  return NextResponse.json(
    {error: 'Too many attempts. Please try again later.'},
    {status: 429, headers: {'retry-after': String(retryAfter)}},
  );
}

export async function POST(req: NextRequest) {
  let body: {email?: unknown; password?: unknown};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  if (!email || !password) return NextResponse.json({error: 'Email and password are required'}, {status: 400});

  const ip = clientIp(req.headers);
  const perIp = hit(`login:ip:${ip}`, 30, 60_000);
  if (!perIp.ok) return tooMany(perIp.retryAfter);
  const perEmail = hit(`login:email:${email}`, 20, 5 * 60_000);
  if (!perEmail.ok) return tooMany(perEmail.retryAfter);

  const failKey = `login:fail:${email}`;
  if (isLocked(failKey, MAX_FAILURES, FAILURE_WINDOW_MS, LOCK_MS)) {
    logAuthEvent('login_blocked', {email, ip, reason: 'lockout'});
    return tooMany(LOCK_MS / 1000);
  }

  const user = await prisma.user.findUnique({where: {email}});
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok) {
    const lock = failHit(failKey, MAX_FAILURES, FAILURE_WINDOW_MS, LOCK_MS);
    logAuthEvent('login_failed', {email, ip, locked: lock.locked});
    if (lock.locked) return tooMany(lock.retryAfter);
    return NextResponse.json({error: 'Invalid email or password'}, {status: 401});
  }

  reset(failKey);
  if (user.totpEnabled) {
    const challenge = await createTwoFactorChallenge(user.id, user.tokenVersion);
    logAuthEvent('login_2fa_required', {email, ip});
    return NextResponse.json({requires2FA: true, challenge});
  }
  await setSessionCookie(user.id, user.tokenVersion);
  logAuthEvent('login_success', {userId: user.id, email, ip});
  return NextResponse.json({
    user: {id: user.id, email: user.email, fullName: user.fullName, currencySymbol: user.currencySymbol},
  });
}
