import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {normalizeInviteCode} from '@/lib/household';
import {hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';
import {validate} from '@/lib/validation';

const schema = z.object({code: z.string().trim().min(1).max(32)});

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const limit = hit(`household:join:${auth.user.id}`, 10, 60_000);
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

  const code = normalizeInviteCode(parsed.data.code);
  const target = await prisma.household.findUnique({where: {inviteCode: code}});
  if (!target) return NextResponse.json({error: 'That invite code does not match any household'}, {status: 400});

  const current = await prisma.householdMember.findFirst({where: {userId: auth.user.id}});
  if (current) {
    if (current.householdId === target.id) {
      return NextResponse.json({error: 'You are already a member of that household'}, {status: 400});
    }
    const currentCount = await prisma.householdMember.count({where: {householdId: current.householdId}});
    if (currentCount > 1) {
      return NextResponse.json({error: 'Leave your current household before joining another'}, {status: 400});
    }
    // Solo member: dropping the membership empties the household, so remove both.
    await prisma.$transaction([
      prisma.householdMember.delete({where: {id: current.id}}),
      prisma.household.delete({where: {id: current.householdId}}),
    ]);
  }

  await prisma.householdMember.create({
    data: {householdId: target.id, userId: auth.user.id, role: 'MEMBER'},
  });
  logAuthEvent('household_joined', {userId: auth.user.id, householdId: target.id});
  return NextResponse.json({ok: true, householdId: target.id, name: target.name});
}
