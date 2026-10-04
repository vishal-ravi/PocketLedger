import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {setSessionCookie, verifyTwoFactorChallenge} from '@/lib/auth';
import {hashBackupCode, verifyBackupCode, verifyTotp} from '@/lib/totp';
import {clientIp, hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';
import {validate} from '@/lib/validation';

const schema = z.object({
  challenge: z.string().min(1),
  code: z.string().trim().min(6).max(10),
});

function tooMany(retryAfter: number): NextResponse {
  return NextResponse.json(
    {error: 'Too many attempts. Please try again later.'},
    {status: 429, headers: {'retry-after': String(retryAfter)}},
  );
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(schema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const ip = clientIp(req.headers);
  const perIp = hit(`login:2fa:ip:${ip}`, 30, 60_000);
  if (!perIp.ok) return tooMany(perIp.retryAfter);

  const claims = await verifyTwoFactorChallenge(parsed.data.challenge);
  if (!claims) {
    return NextResponse.json({error: 'Challenge expired. Please sign in again.'}, {status: 401});
  }

  const user = await prisma.user.findUnique({where: {id: claims.id}});
  if (!user || user.tokenVersion !== claims.tv || !user.totpEnabled || !user.totpSecret) {
    return NextResponse.json({error: 'Challenge expired. Please sign in again.'}, {status: 401});
  }

  const perUser = hit(`login:2fa:user:${user.id}`, 15, 60_000);
  if (!perUser.ok) return tooMany(perUser.retryAfter);

  let ok = verifyTotp(user.totpSecret, parsed.data.code);
  let usedBackup = false;
  if (!ok) {
    let hashed: string[] = [];
    try {
      hashed = user.backupCodes ? JSON.parse(user.backupCodes) : [];
    } catch {
      hashed = [];
    }
    if (hashed.length > 0 && verifyBackupCode(hashed, parsed.data.code)) {
      ok = true;
      usedBackup = true;
      const consumed = hashBackupCode(parsed.data.code);
      await prisma.user.update({
        where: {id: user.id},
        data: {backupCodes: JSON.stringify(hashed.filter((entry) => entry !== consumed))},
      });
    }
  }

  if (!ok) {
    logAuthEvent('login_2fa_failed', {userId: user.id, email: user.email, ip});
    return NextResponse.json({error: 'Invalid authentication code'}, {status: 401});
  }

  await setSessionCookie(user.id, user.tokenVersion);
  logAuthEvent('login_success', {
    userId: user.id,
    email: user.email,
    ip,
    method: usedBackup ? 'backup_code' : 'totp',
  });
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      currencySymbol: user.currencySymbol,
    },
  });
}
