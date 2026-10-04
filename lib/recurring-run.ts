import {prisma} from '@/lib/prisma';
import {catchUp, type Interval} from '@/lib/recurring';
import {daysUntil} from '@/lib/analytics';
import {sendMail} from '@/lib/mailer';

type RuleRow = import('@/lib/recurring').RecurringRow;

type Method = 'UPI' | 'CREDIT_CARD' | 'CASH' | 'DEBIT_CARD' | 'BANK_TRANSFER';

function expenseData(userId: string, rule: RuleRow, date: Date) {
  return {
    userId,
    date,
    categoryId: rule.categoryId,
    description: rule.description,
    paymentMethod: rule.paymentMethod as Method,
    creditCardId: rule.paymentMethod === 'CREDIT_CARD' ? rule.creditCardId : null,
    amount: Number(rule.amount),
    type: rule.type as 'NEED' | 'WANT' | 'INCOME',
    myShare: Number(rule.amount),
    isSplit: false,
    whoPaid: 'Me',
    notes: rule.notes ?? null,
  };
}

/**
 * Post every auto-due occurrence and send due-soon reminders.
 * Called from GET/POST so the schedule stays current without a cron job.
 */
export async function runRecurring(members: {id: string; email: string}[], now = new Date()) {
  for (const {id: userId, email} of members) await runRecurringFor(userId, email, now);
}

async function runRecurringFor(userId: string, email: string, now: Date) {
  const rules = await prisma.recurringRule.findMany({
    where: {userId},
    include: {category: {select: {name: true}}, creditCard: {select: {cardName: true}}},
    orderBy: {nextDueDate: 'asc'},
  });

  for (const rule of rules) {
    if (rule.paused) continue;

    if (rule.autoPost) {
      const {due, nextDue} = catchUp(
        {nextDueDate: rule.nextDueDate, interval: rule.interval as Interval, endDate: rule.endDate},
        now,
      );
      if (due.length > 0) {
        await prisma.$transaction([
          ...due.map((date) => prisma.expense.create({data: expenseData(userId, rule, date)})),
          prisma.recurringRule.update({
            where: {id: rule.id},
            data: nextDue
              ? {nextDueDate: nextDue, remindedAt: null}
              : {paused: true, remindedAt: null},
          }),
        ]);
        rule.nextDueDate = nextDue ?? rule.nextDueDate;
      } else if (nextDue && nextDue.getTime() !== new Date(rule.nextDueDate).getTime()) {
        await prisma.recurringRule.update({where: {id: rule.id}, data: {nextDueDate: nextDue, remindedAt: null}});
        rule.nextDueDate = nextDue;
      } else if (!nextDue) {
        await prisma.recurringRule.update({where: {id: rule.id}, data: {paused: true}});
        rule.paused = true;
      }
    }

    // one reminder per scheduled occurrence, at most 2 days ahead (or when overdue)
    const days = daysUntil(rule.nextDueDate, now);
    if (days <= 2 && !rule.remindedAt) {
      const label = days < 0 ? `${Math.abs(days)} day(s) overdue` : days === 0 ? 'due today' : `due in ${days} day(s)`;
      await sendMail({
        to: email,
        subject: `PocketLedger: ${rule.description} is ${label}`,
        text: [
          `${rule.description} — ${rule.amount} — is ${label} (${rule.nextDueDate.toISOString().slice(0, 10)}).`,
          rule.autoPost
            ? 'Auto-post is on: the transaction will be added to your ledger automatically.'
            : 'Record it from the Recurring page when you pay.',
          '',
          `${process.env.APP_URL ?? 'http://localhost:3000'}/recurring`,
        ].join('\n'),
      }).catch(() => null);
      await prisma.recurringRule.update({where: {id: rule.id}, data: {remindedAt: now}}).catch(() => null);
    }
  }
}

