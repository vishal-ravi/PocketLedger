import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {recurringPatchSchema, validate} from '@/lib/validation';
import {toRecurringDto} from '@/lib/recurring';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};
const include = {category: {select: {name: true}}, creditCard: {select: {cardName: true}}} as const;

async function findRule(id: string, memberIds: string[]) {
  return prisma.recurringRule.findFirst({where: {id, userId: {in: memberIds}}, include});
}

export async function GET(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const rule = await findRule(id, memberIds);
  if (!rule) return NextResponse.json({error: 'recurring rule not found'}, {status: 404});
  return NextResponse.json({rule: toRecurringDto(rule)});
}

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await findRule(id, memberIds);
  if (!existing) return NextResponse.json({error: 'recurring rule not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(recurringPatchSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const input = parsed.data;
  if (input.categoryId) {
    const category = await prisma.category.findFirst({where: {id: input.categoryId, userId: {in: memberIds}}});
    if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  }
  if (input.creditCardId) {
    const card = await prisma.creditCard.findFirst({where: {id: input.creditCardId, userId: {in: memberIds}}});
    if (!card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  }

  const method = input.paymentMethod ?? existing.paymentMethod;
  const data = {
    ...input,
    creditCardId: method === 'CREDIT_CARD' ? (input.creditCardId ?? existing.creditCardId) : null,
    ...(input.startDate ? {nextDueDate: input.startDate, remindedAt: null} : {}),
  };

  const rule = await prisma.recurringRule.update({where: {id}, data, include});
  return NextResponse.json({rule: toRecurringDto(rule)});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await findRule(id, memberIds);
  if (!existing) return NextResponse.json({error: 'recurring rule not found'}, {status: 404});
  await prisma.recurringRule.delete({where: {id}});
  return NextResponse.json({ok: true});
}
