import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {generateInviteCode} from '@/lib/household';
import {hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';

export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const limit = hit(`household:regen:${auth.user.id}`, 10, 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {error: 'Too many attempts. Please try again in a minute.'},
      {status: 429, headers: {'retry-after': String(limit.retryAfter)}},
    );
  }

  const membership = await prisma.householdMember.findFirst({where: {userId: auth.user.id}});
  if (!membership) return NextResponse.json({error: 'You are not part of a household'}, {status: 400});
  if (membership.role !== 'OWNER') {
    return NextResponse.json({error: 'Only the household owner can regenerate the invite code'}, {status: 403});
  }

  let code = generateInviteCode();
  for (let attempt = 0; attempt < 10; attempt++) {
    const taken = await prisma.household.findUnique({where: {inviteCode: code}, select: {id: true}});
    if (!taken || taken.id === membership.householdId) break;
    code = generateInviteCode();
  }
  await prisma.household.update({where: {id: membership.householdId}, data: {inviteCode: code}});
  logAuthEvent('household_invite_regenerated', {userId: auth.user.id, householdId: membership.householdId});
  return NextResponse.json({ok: true, inviteCode: code});
}
