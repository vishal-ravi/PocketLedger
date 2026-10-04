import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {sharedMemberIds} from '@/lib/household';
import {goalSchema, validate} from '@/lib/validation';
import {toDto} from '@/lib/goals';
import {requireUser} from '@/lib/auth';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const goals = await prisma.goal.findMany({
    where: {userId: {in: memberIds}},
    orderBy: {createdAt: 'asc'},
  });
  return NextResponse.json({goals: goals.map(toDto)});
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(goalSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const {name, targetAmount, savedAmount, targetDate, colorCode} = parsed.data;
  const goal = await prisma.goal.create({
    data: {
      userId: auth.user.id,
      name,
      targetAmount,
      savedAmount: savedAmount ?? 0,
      targetDate: targetDate ?? null,
      colorCode,
    },
  });
  return NextResponse.json({goal: toDto(goal)}, {status: 201});
}
