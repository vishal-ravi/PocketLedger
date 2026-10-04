import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {generateBackupCodes, hashBackupCodes, verifyTotp} from '@/lib/totp';
import {hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';
import {validate} from '@/lib/validation';

const schema = z.object({code: z.string().trim().min(6).max(10)});

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const limit = hit(`2fa:verify:${auth.user.id}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {error: 'Too many attempts. Please try again in a minute.'},
      {status: 429, headers: {'retry-after': String(limit.retryAfter)}},
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

  const user = await prisma.user.findUnique({
    where: {id: auth.user.id},
    select: {totpEnabled: true, totpSecret: true},
  });
  if (!user) return NextResponse.json({error: 'profile not found'}, {status: 404});
  if (user.totpEnabled) return NextResponse.json({error: 'Two-factor authentication is already enabled'}, {status: 400});
  if (!user.totpSecret) return NextResponse.json({error: 'Start setup first'}, {status: 400});

  if (!verifyTotp(user.totpSecret, parsed.data.code)) {
    logAuthEvent('2fa_verify_failed', {userId: auth.user.id});
    return NextResponse.json({error: 'Invalid authentication code. Check your authenticator app and try again.'}, {status: 401});
  }

  const backupCodes = generateBackupCodes(8);
  await prisma.user.update({
    where: {id: auth.user.id},
    data: {totpEnabled: true, backupCodes: JSON.stringify(hashBackupCodes(backupCodes))},
  });
  logAuthEvent('2fa_enabled', {userId: auth.user.id});
  return NextResponse.json({ok: true, backupCodes});
}
