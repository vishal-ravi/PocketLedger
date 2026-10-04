import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {verifyBackupCode, verifyTotp} from '@/lib/totp';
import {verifyPassword} from '@/lib/password';
import {clientIp, hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';
import {validate} from '@/lib/validation';

const schema = z.object({
  password: z.string().min(1, 'Password is required'),
  code: z.string().trim().min(6).max(10),
});

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const ip = clientIp(req.headers);
  const perIp = hit(`2fa:disable:ip:${ip}`, 20, 60_000);
  const perUser = hit(`2fa:disable:user:${auth.user.id}`, 10, 60_000);
  if (!perIp.ok || !perUser.ok) {
    const retryAfter = Math.max(perIp.retryAfter, perUser.retryAfter);
    return NextResponse.json(
      {error: 'Too many attempts. Please try again in a minute.'},
      {status: 429, headers: {'retry-after': String(retryAfter)}},
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(schema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const user = await prisma.user.findUnique({where: {id: auth.user.id}});
  if (!user) return NextResponse.json({error: 'profile not found'}, {status: 404});
  if (!user.totpEnabled) return NextResponse.json({error: 'Two-factor authentication is not enabled'}, {status: 400});

  if (!(await verifyPassword(parsed.data.password, user.passwordHash))) {
    logAuthEvent('2fa_disable_failed', {userId: user.id, reason: 'password'});
    return NextResponse.json({error: 'Incorrect password'}, {status: 401});
  }

  let hashed: string[] = [];
  try {
    hashed = user.backupCodes ? JSON.parse(user.backupCodes) : [];
  } catch {
    hashed = [];
  }
  const codeOk =
    (user.totpSecret !== null && verifyTotp(user.totpSecret, parsed.data.code)) ||
    (hashed.length > 0 && verifyBackupCode(hashed, parsed.data.code));
  if (!codeOk) {
    logAuthEvent('2fa_disable_failed', {userId: user.id, reason: 'code'});
    return NextResponse.json({error: 'Invalid authentication code'}, {status: 401});
  }

  await prisma.user.update({
    where: {id: user.id},
    data: {totpEnabled: false, totpSecret: null, backupCodes: null},
  });
  logAuthEvent('2fa_disabled', {userId: user.id});
  return NextResponse.json({ok: true});
}
