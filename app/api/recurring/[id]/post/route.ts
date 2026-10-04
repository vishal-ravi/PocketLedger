import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {addInterval, toRecurringDto, todayKey} from '@/lib/recurring';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};
const include = {category: {select: {name: true}}, creditCard: {select: {cardName: true}}} as const;

/** Manually record the current due occurrence, then realign the schedule to the future. */
export async function POST(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const rule = await prisma.recurringRule.findFirst({where: {id, userId: {in: memberIds}}, include});
  if (!rule) return NextResponse.json({error: 'recurring rule not found'}, {status: 404});
  if (rule.paused) return NextResponse.json({error: 'rule is paused'}, {status: 409});

  const today = todayKey();
  const scheduled = new Date(rule.nextDueDate);
  let next = scheduled;
  // skip any missed occurrences so a manual post realigns the schedule
  for (let i = 0; i < 120 && next.toISOString().slice(0, 10) <= today; i++) {
    next = addInterval(next, rule.interval as 'WEEKLY' | 'MONTHLY' | 'YEARLY');
  }
  const pastEnd = rule.endDate && next > rule.endDate;

  const expense = await prisma.$transaction([
    prisma.expense.create({
      data: {
        userId: auth.user.id,
        date: scheduled,
        categoryId: rule.categoryId,
        description: rule.description,
        paymentMethod: rule.paymentMethod,
        creditCardId: rule.paymentMethod === 'CREDIT_CARD' ? rule.creditCardId : null,
        amount: Number(rule.amount),
        type: rule.type,
        myShare: Number(rule.amount),
        isSplit: false,
        whoPaid: 'Me',
        notes: rule.notes ?? null,
      },
    }),
    prisma.recurringRule.update({
      where: {id: rule.id},
      data: pastEnd ? {paused: true, remindedAt: null} : {nextDueDate: next, remindedAt: null},
    }),
  ]);

  const fresh = await prisma.recurringRule.findFirst({where: {id: rule.id}, include});
  return NextResponse.json({expenseId: expense[0].id, rule: fresh ? toRecurringDto(fresh) : null});
}
