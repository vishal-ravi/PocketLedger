import {NextResponse} from 'next/server';
import QRCode from 'qrcode';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {generateTotpSecret, otpauthUri} from '@/lib/totp';
import {logAuthEvent} from '@/lib/logger';

export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const user = await prisma.user.findUnique({
    where: {id: auth.user.id},
    select: {email: true, totpEnabled: true},
  });
  if (!user) return NextResponse.json({error: 'profile not found'}, {status: 404});
  if (user.totpEnabled) {
    return NextResponse.json({error: 'Two-factor authentication is already enabled'}, {status: 400});
  }

  const secret = generateTotpSecret();
  await prisma.user.update({where: {id: auth.user.id}, data: {totpSecret: secret}});
  const uri = otpauthUri(user.email, secret);
  const qr = await QRCode.toDataURL(uri, {margin: 1, width: 240});
  logAuthEvent('2fa_setup_started', {userId: auth.user.id});
  return NextResponse.json({secret, uri, qr});
}
