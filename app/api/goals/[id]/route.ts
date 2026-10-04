import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {sharedMemberIds} from '@/lib/household';
import {goalPatchSchema, validate} from '@/lib/validation';
import {toDto} from '@/lib/goals';
import {requireUser} from '@/lib/auth';

type Params = {params: Promise<{id: string}>};

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.goal.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'goal not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(goalPatchSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  // Zod applies schema defaults during parse, so only touch keys the caller sent.
  const provided = new Set(Object.keys((body ?? {}) as Record<string, unknown>));
  const {contribute, ...fields} = parsed.data;
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined && provided.has(key)) data[key] = value;
  }
  if (data.savedAmount === undefined && contribute !== undefined) {
    data.savedAmount = Math.max(0, Number(existing.savedAmount) + contribute);
  }

  const goal = await prisma.goal.update({where: {id}, data});
  return NextResponse.json({goal: toDto(goal)});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.goal.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'goal not found'}, {status: 404});
  await prisma.goal.delete({where: {id}});
  return NextResponse.json({ok: true});
}
