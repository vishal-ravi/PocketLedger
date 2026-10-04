import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {bandFor, billingCycle, daysUntil, monthBuckets, nextOccurrence, startOfDay} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const round = (value: number) => Math.round(value * 100) / 100;
const isoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const scanStart = new Date(now.getFullYear(), now.getMonth() - 6, 1);

  const cards = await prisma.creditCard.findMany({
    where: {userId: {in: memberIds}},
    include: {
      expenses: {
        where: {type: {not: 'INCOME'}, date: {gte: scanStart}},
        include: {category: {select: {id: true, name: true, colorCode: true}}},
        orderBy: {date: 'asc'},
      },
    },
    orderBy: {cardName: 'asc'},
  });

  const buckets = monthBuckets(6, now);

  const rows = cards.map((card) => {
    const limit = Number(card.creditLimit);
    const apr = card.apr === null ? null : Number(card.apr);
    const rewardsRate = card.rewardsRate === null ? null : Number(card.rewardsRate);
    const all = card.expenses;

    const monthSpend = all
      .filter((row) => row.date >= monthStart)
      .reduce((sum, row) => sum + Number(row.amount), 0);

    const cycle = billingCycle(card.statementGenerationDay, now);
    const cycleRows = all.filter((row) => row.date >= cycle.start && row.date < cycle.end);
    const cycleSpend = cycleRows.reduce((sum, row) => sum + Number(row.amount), 0);

    const avgPerDay = cycle.elapsed > 0 ? cycleSpend / cycle.elapsed : 0;
    const projectedBill = round(cycleSpend + avgPerDay * cycle.daysLeft);

    const utilisation = limit > 0 ? round((monthSpend / limit) * 100) : 0;
    const cycleUtilisation = limit > 0 ? round((projectedBill / limit) * 100) : 0;

    const statementDate = cycle.end;
    const dueDate = nextOccurrence(card.dueDay, now);
    const daysToStatement = daysUntil(statementDate, now);
    const daysToDue = daysUntil(dueDate, now);

    const rewards = rewardsRate !== null ? round((projectedBill * rewardsRate) / 100) : null;
    const minDue = Math.min(projectedBill, Math.max(500, projectedBill * 0.05));
    const rollover = Math.max(0, projectedBill - minDue);
    const interest = apr !== null && apr > 0 ? round((rollover * apr) / 100 / 12) : null;

    const monthly = buckets.map((bucket) => ({
      month: bucket.label,
      amount: round(
        all
          .filter((row) => row.date >= bucket.start && row.date < bucket.end)
          .reduce((sum, row) => sum + Number(row.amount), 0),
      ),
    }));

    const splitMap = new Map<string, {name: string; color: string; amount: number}>();
    for (const row of all) {
      if (row.date < buckets[0].start) continue;
      if (!row.category || row.type === 'INCOME') continue;
      const existing = splitMap.get(row.category.id);
      const amount = Number(row.amount);
      if (existing) existing.amount += amount;
      else splitMap.set(row.category.id, {name: row.category.name, color: row.category.colorCode, amount});
    }
    const categorySplit = [...splitMap.values()]
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 4)
      .map((entry) => ({...entry, amount: round(entry.amount)}));

    return {
      id: card.id,
      cardName: card.cardName,
      notes: card.notes,
      creditLimit: limit,
      apr,
      rewardsRate,
      statementGenerationDay: card.statementGenerationDay,
      dueDay: card.dueDay,
      monthSpend: round(monthSpend),
      cycleSpend: round(cycleSpend),
      available: round(limit - monthSpend),
      utilisation,
      cycleUtilisation,
      band: bandFor(cycleUtilisation || utilisation),
      cycle: {start: isoDay(cycle.start), end: isoDay(cycle.end), daysLeft: cycle.daysLeft, totalDays: cycle.totalDays, elapsed: cycle.elapsed},
      statementDate: isoDay(statementDate),
      daysToStatement,
      dueDate: isoDay(dueDate),
      daysToDue,
      projectedBill,
      minDue: round(minDue),
      interest,
      rewards,
      monthly,
      categorySplit,
      transactionCount: all.length,
    };
  });

  const totals = {
    creditLimit: round(rows.reduce((sum, row) => sum + row.creditLimit, 0)),
    monthSpend: round(rows.reduce((sum, row) => sum + row.monthSpend, 0)),
    cycleSpend: round(rows.reduce((sum, row) => sum + row.cycleSpend, 0)),
    projectedBill: round(rows.reduce((sum, row) => sum + row.projectedBill, 0)),
    available: round(rows.reduce((sum, row) => sum + row.creditLimit - row.monthSpend, 0)),
    rewards: round(rows.reduce((sum, row) => sum + (row.rewards ?? 0), 0)),
    interest: round(rows.reduce((sum, row) => sum + (row.interest ?? 0), 0)),
    utilisation: 0,
    dueSoon: rows.filter((row) => row.daysToDue <= 5).length,
    totalCards: rows.length,
  };
  totals.utilisation = totals.creditLimit > 0 ? round((totals.monthSpend / totals.creditLimit) * 100) : 0;

  return NextResponse.json({cards: rows, totals, today: isoDay(today)});
}
