import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const user = await prisma.user.findUnique({
    where: {id: auth.user.id},
    select: {totpEnabled: true, totpSecret: true},
  });
  if (!user) return NextResponse.json({error: 'profile not found'}, {status: 404});
  return NextResponse.json({
    enabled: user.totpEnabled,
    pending: !user.totpEnabled && user.totpSecret !== null,
  });
}
