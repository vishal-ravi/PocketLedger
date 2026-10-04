import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {clientIp, hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';
import {createAuthToken} from '@/lib/tokens';
import {sendMail} from '@/lib/mailer';
import {appUrl} from '@/lib/urls';

const RESET_TTL_MINUTES = 60;

/** Always answers the same way so the endpoint can't be used to probe which emails exist. */
export async function POST(req: NextRequest) {
  let body: {email?: unknown};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const email = String(body.email ?? '').trim().toLowerCase();
  if (!email) return NextResponse.json({error: 'Email is required'}, {status: 400});

  const ip = clientIp(req.headers);
  const limit = hit(`forgot:ip:${ip}`, 10, 15 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {error: 'Too many attempts. Please try again later.'},
      {status: 429, headers: {'retry-after': String(limit.retryAfter)}},
    );
  }

  const user = await prisma.user.findUnique({where: {email}});
  if (user) {
    const {token} = await createAuthToken(email, 'RESET_PASSWORD', RESET_TTL_MINUTES, user.id);
    await sendMail({
      to: email,
      subject: 'Reset your PocketLedger password',
      text: [
        `Hi ${user.fullName},`,
        '',
        'Use the link below to choose a new password (valid for 60 minutes):',
        `${appUrl()}/reset-password?token=${token}`,
        '',
        'If you did not request this, you can safely ignore this email — your password has not changed.',
      ].join('\n'),
    });
    logAuthEvent('password_reset_requested', {userId: user.id, email, ip});
  } else {
    logAuthEvent('password_reset_unknown_email', {email, ip});
  }

  return NextResponse.json({ok: true}, {status: 202});
}
