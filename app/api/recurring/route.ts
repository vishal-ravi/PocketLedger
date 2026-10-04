import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {recurringSchema, validate} from '@/lib/validation';
import {toRecurringDto} from '@/lib/recurring';
import {requireUser} from '@/lib/auth';
import {runRecurring} from '@/lib/recurring-run';
import {memberAccounts, sharedMemberIds} from '@/lib/household';

const include = {category: {select: {name: true}}, creditCard: {select: {cardName: true}}} as const;

async function ownsRefs(memberIds: string[], input: {categoryId?: string | null; creditCardId?: string | null}) {
  if (input.categoryId) {
    const category = await prisma.category.findFirst({where: {id: input.categoryId, userId: {in: memberIds}}});
    if (!category) return 'categoryId: unknown category';
  }
  if (input.creditCardId) {
    const card = await prisma.creditCard.findFirst({where: {id: input.creditCardId, userId: {in: memberIds}}});
    if (!card) return 'creditCardId: unknown card';
  }
  return null;
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  await runRecurring(await memberAccounts(memberIds));
  const rules = await prisma.recurringRule.findMany({
    where: {userId: {in: memberIds}},
    include,
    orderBy: {nextDueDate: 'asc'},
  });
  return NextResponse.json({rules: rules.map((rule) => toRecurringDto(rule))});
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
  const parsed = validate(recurringSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const input = parsed.data;
  const memberIds = await sharedMemberIds(auth.user.id);
  const conflict = await ownsRefs(memberIds, input);
  if (conflict) return NextResponse.json({error: conflict}, {status: 400});

  await prisma.recurringRule.create({
    data: {
      userId: auth.user.id,
      description: input.description,
      amount: input.amount,
      type: input.type,
      categoryId: input.categoryId ?? null,
      paymentMethod: input.paymentMethod,
      creditCardId: input.paymentMethod === 'CREDIT_CARD' ? (input.creditCardId ?? null) : null,
      interval: input.interval,
      startDate: input.startDate,
      nextDueDate: input.startDate,
      endDate: input.endDate ?? null,
      autoPost: input.autoPost,
      paused: input.paused,
      notes: input.notes ?? null,
    },
  });

  await runRecurring(await memberAccounts(memberIds));
  const rules = await prisma.recurringRule.findMany({
    where: {userId: {in: memberIds}},
    include,
    orderBy: {createdAt: 'desc'},
    take: 1,
  });
  return NextResponse.json({rule: rules[0] ? toRecurringDto(rules[0]) : null}, {status: 201});
}
