import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {pickNewOwner} from '@/lib/household';
import {logAuthEvent} from '@/lib/logger';

export async function POST() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const membership = await prisma.householdMember.findFirst({where: {userId: auth.user.id}});
  if (!membership) return NextResponse.json({error: 'You are not part of a household'}, {status: 400});

  const others = await prisma.householdMember.findMany({where: {householdId: membership.householdId}});
  if (others.length <= 1) {
    await prisma.household.delete({where: {id: membership.householdId}}).catch(() => null);
    logAuthEvent('household_left', {userId: auth.user.id, householdId: membership.householdId, alone: true});
    return NextResponse.json({ok: true, householdId: null});
  }

  await prisma.householdMember.delete({where: {id: membership.id}});
  if (membership.role === 'OWNER') {
    const successor = pickNewOwner(others.filter((member) => member.id !== membership.id));
    if (successor) {
      await prisma.householdMember.update({
        where: {id: others.find((member) => member.userId === successor.userId)!.id},
        data: {role: 'OWNER'},
      });
    }
  }
  logAuthEvent('household_left', {userId: auth.user.id, householdId: membership.householdId, alone: false});
  return NextResponse.json({ok: true, householdId: null});
}
