import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {splitTotals} from '@/lib/debts';
import {
  DAY_MS,
  billingCycle,
  daysInMonth,
  daysUntil,
  detectSubscriptions,
  isoDay,
  nextOccurrence,
  projectMonth,
  round2,
  startOfDay,
  streaksFor,
  summarize,
} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {memberAccounts, sharedMemberIds} from '@/lib/household';
import {runRecurring} from '@/lib/recurring-run';
import {rolloverAmount, computeNetWorth} from '@/lib/networth';

const METHOD_LABELS: Record<string, string> = {
  UPI: 'UPI',
  CREDIT_CARD: 'Credit card',
  CASH: 'Cash',
  DEBIT_CARD: 'Debit card',
  BANK_TRANSFER: 'Bank transfer',
};

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const now = new Date();
  const today = startOfDay(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const elapsed = Math.max(1, now.getDate());
  const daysLeft = dim - now.getDate();
  const scanStart = new Date(today.getTime() - 190 * DAY_MS);
  const trailStart = new Date(today.getTime() - 30 * DAY_MS);
  const usualStart = new Date(today.getTime() - 30 * DAY_MS);

  await runRecurring(await memberAccounts(memberIds), now);

  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const [rows, categories, cards, splitRows, loanRows, recurringRows, userRow, prevSpend, accounts, cardDues] =
    await Promise.all([
    prisma.expense.findMany({
      where: {userId: {in: memberIds}, date: {gte: scanStart}},
      include: {category: {select: {id: true, name: true, colorCode: true}}},
      orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
      take: 5000,
    }),
    prisma.category.findMany({where: {userId: {in: memberIds}}}),
    prisma.creditCard.findMany({
      where: {userId: {in: memberIds}},
      include: {
        expenses: {
          where: {type: {not: 'INCOME'}, date: {gte: new Date(today.getTime() - 45 * DAY_MS)}},
          select: {amount: true, date: true},
        },
      },
    }),
    prisma.splitDetail.findMany({where: {status: 'PENDING', expense: {userId: {in: memberIds}}}}),
    prisma.loan.findMany({
      where: {userId: {in: memberIds}},
      include: {installments: true},
    }),
    prisma.recurringRule.findMany({
      where: {
        userId: {in: memberIds},
        paused: false,
        nextDueDate: {lte: new Date(today.getTime() + 45 * DAY_MS)},
      },
      include: {category: {select: {name: true}}, creditCard: {select: {cardName: true}}},
      orderBy: {nextDueDate: 'asc'},
      take: 6,
    }),
    prisma.user.findUnique({where: {id: auth.user.id}, select: {budgetRollover: true}}),
    prisma.expense.groupBy({
      by: ['categoryId'],
      where: {userId: {in: memberIds}, type: {not: 'INCOME'}, date: {gte: prevMonthStart, lt: monthStart}},
      _sum: {amount: true},
    }),
    prisma.account.findMany({where: {userId: {in: memberIds}}, orderBy: {createdAt: 'asc'}}),
    prisma.expense.groupBy({
      by: ['creditCardId'],
      where: {userId: {in: memberIds}, type: {not: 'INCOME'}, creditCardId: {not: null}},
      _sum: {amount: true},
    }),
  ]);

  // ---- month summary (matches GET /api/analytics/summary) -----------------
  const monthRows = rows.filter((row) => row.date >= monthStart);
  const summary = summarize(
    monthRows.map((row) => ({type: row.type, amount: Number(row.amount), category: row.category?.name ?? 'Income'})),
    elapsed,
  );

  // ---- budget ring + safe to spend ----------------------------------------
  const budget = categories.reduce((sum, category) => sum + Number(category.monthlyBudget), 0);
  const prevSpendById = new Map(prevSpend.map((row) => [row.categoryId, Number(row._sum.amount ?? 0)]));
  const rollover = userRow?.budgetRollover
    ? round2(
        categories.reduce(
          (sum, category) => sum + rolloverAmount(Number(category.monthlyBudget), prevSpendById.get(category.id) ?? 0),
          0,
        ),
      )
    : 0;
  const budgetTotal = round2(budget + rollover);
  const spent = monthRows.filter((row) => row.type !== 'INCOME').reduce((sum, row) => sum + Number(row.amount), 0);
  const perCategory = new Map<string, {mtd: number; trail: number}>();
  for (const row of rows) {
    if (row.type === 'INCOME' || !row.category) continue;
    const entry = perCategory.get(row.category.id) ?? {mtd: 0, trail: 0};
    if (row.date >= monthStart) entry.mtd += Number(row.amount);
    if (row.date >= trailStart) entry.trail += Number(row.amount);
    perCategory.set(row.category.id, entry);
  }
  const projected = categories.reduce(
    (sum, category) => {
      const entry = perCategory.get(category.id);
      return sum + projectMonth(entry?.trail ?? 0, entry?.mtd ?? 0, elapsed, dim);
    },
    0,
  );
  const pct = budgetTotal > 0 ? Math.min(100, round2((spent / budgetTotal) * 100)) : 0;
  const remaining = round2(Math.max(0, budgetTotal - spent));
  const budgetStatus =
    budgetTotal <= 0 ? 'no-budget' : spent > budgetTotal ? 'over' : projected > budgetTotal ? 'watch' : 'on-track';

  // ---- pace anomaly --------------------------------------------------------
  const usualDaily =
    rows
      .filter((row) => row.type !== 'INCOME' && row.date >= usualStart && row.date < today)
      .reduce((sum, row) => sum + Number(row.amount), 0) / 30;
  const expected = usualDaily * elapsed;
  const pacePct = expected > 0 ? round2(((spent - expected) / expected) * 100) : 0;
  const flagged = expected > 0 && pacePct >= 15;
  const anomaly = {
    flagged,
    pacePct,
    expected: round2(expected),
    actual: round2(spent),
    usualDaily: round2(usualDaily),
    message: flagged
      ? `You're spending ${Math.abs(pacePct)}% faster than your usual ${round2(usualDaily)} per day.`
      : expected > 0
        ? `You're tracking ${Math.abs(pacePct)}% ${pacePct >= 0 ? 'above' : 'below'} your usual daily pace.`
        : 'Not enough history yet to compare your pace.',
  };

  // ---- streaks -------------------------------------------------------------
  const daily = new Map<string, number>();
  for (const row of rows) {
    if (row.type === 'INCOME') continue;
    const key = isoDay(row.date);
    daily.set(key, (daily.get(key) ?? 0) + Number(row.amount));
  }
  const streaks = {
    ...streaksFor(daily, today, budget > 0 ? budget / dim : 0),
    daysLogged: new Set(monthRows.filter((row) => row.type !== 'INCOME').map((row) => isoDay(row.date))).size,
    daysInMonth: dim,
    daysLeft,
  };

  // ---- payment mix + top categories ---------------------------------------
  const mix = new Map<string, {method: string; label: string; amount: number; count: number}>();
  for (const row of monthRows) {
    if (row.type === 'INCOME') continue;
    const entry = mix.get(row.paymentMethod) ?? {
      method: row.paymentMethod,
      label: METHOD_LABELS[row.paymentMethod] ?? row.paymentMethod,
      amount: 0,
      count: 0,
    };
    entry.amount += Number(row.amount);
    entry.count += 1;
    mix.set(row.paymentMethod, entry);
  }
  const paymentMix = [...mix.values()].sort((a, b) => b.amount - a.amount);

  const topCategories = categories
    .map((category) => ({
      id: category.id,
      name: category.name,
      color: category.colorCode,
      amount: round2(perCategory.get(category.id)?.mtd ?? 0),
    }))
    .filter((row) => row.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  // ---- recent transactions -------------------------------------------------
  const recent = rows.slice(0, 5).map((row) => ({
    id: row.id,
    description: row.description,
    amount: round2(Number(row.amount)),
    date: isoDay(row.date),
    type: row.type,
    method: row.paymentMethod,
    category: row.category?.name ?? 'Income',
    color: row.category?.colorCode ?? '#10b981',
  }));

  // ---- upcoming payments ---------------------------------------------------
  const upcomingCards = cards
    .map((card) => {
      const due = nextOccurrence(card.dueDay, now);
      const cycle = billingCycle(card.statementGenerationDay, now);
      const cycleSpend = card.expenses
        .filter((row) => row.date >= cycle.start && row.date < cycle.end)
        .reduce((sum, row) => sum + Number(row.amount), 0);
      const perDay = cycle.elapsed > 0 ? cycleSpend / cycle.elapsed : 0;
      return {
        id: card.id,
        cardName: card.cardName,
        dueDate: isoDay(due),
        daysToDue: daysUntil(due, now),
        projectedBill: round2(cycleSpend + perDay * cycle.daysLeft),
        statementDate: isoDay(cycle.end),
        daysToStatement: daysUntil(cycle.end, now),
      };
    })
    .sort((a, b) => a.daysToDue - b.daysToDue);

  const upcomingSubscriptions = detectSubscriptions(
    rows.flatMap((row) =>
      row.type !== 'INCOME' && row.category
        ? [{date: row.date, amount: Number(row.amount), description: row.description, categoryId: row.category.id}]
        : [],
    ),
    now,
  )
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime())
    .slice(0, 4)
    .map((row) => ({
      name: row.name,
      amount: round2(row.amount),
      nextDue: isoDay(row.nextDue),
      daysToDue: daysUntil(row.nextDue, now),
      overdue: row.nextDue.getTime() < today.getTime(),
    }));

  // ---- split balances ------------------------------------------------------
  const splitBlock = splitTotals(splitRows);

  // ---- EMIs / loans --------------------------------------------------------
  const emis = loanRows
    .flatMap((loan) =>
      loan.installments
        .filter((row) => row.status === 'DUE')
        .map((row) => ({
          loanId: loan.id,
          lenderName: loan.lenderName,
          number: row.number,
          dueDate: isoDay(row.dueDate),
          daysToDue: daysUntil(row.dueDate, now),
          amount: round2(Number(row.amount)),
        })),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 4);

  const loans = {
    count: loanRows.length,
    outstanding: round2(
      loanRows
        .flatMap((loan) => loan.installments)
        .filter((row) => row.status === 'DUE')
        .reduce((sum, row) => sum + Number(row.amount), 0),
    ),
    monthly: round2(
      loanRows.reduce((sum, loan) => {
        const next = loan.installments
          .filter((row) => row.status === 'DUE')
          .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
        return sum + (next ? Number(next.amount) : 0);
      }, 0),
    ),
    overdue: loanRows
      .flatMap((loan) => loan.installments)
      .filter((row) => row.status === 'DUE' && row.dueDate < now).length,
  };

  const duesById = new Map(cardDues.map((row) => [row.creditCardId, Number(row._sum.amount ?? 0)]));
  const cardDueRows = cards.map((card) => ({
    id: card.id,
    cardName: card.cardName,
    dues: duesById.get(card.id) ?? 0,
  }));
  const loanDueRows = loanRows.map((loan) => ({
    id: loan.id,
    lenderName: loan.lenderName,
    outstanding: loan.installments
      .filter((row) => row.status === 'DUE')
      .reduce((sum, row) => sum + Number(row.amount), 0),
  }));
  const netWorth = computeNetWorth(accounts, cardDueRows, loanDueRows);

  const upcomingRecurring = recurringRows.map((rule) => {
    const daysToDue = daysUntil(rule.nextDueDate, now);
    return {
      id: rule.id,
      description: rule.description,
      amount: round2(Number(rule.amount)),
      nextDue: isoDay(rule.nextDueDate),
      daysToDue,
      interval: rule.interval,
      autoPost: rule.autoPost,
      overdue: daysToDue < 0,
    };
  });

  return NextResponse.json({
    summary,
    budget: {
      budget: round2(budget),
      rollover,
      available: round2(budgetTotal),
      spent: round2(spent),
      projected: round2(projected),
      pct,
      remaining,
      perDay: daysLeft > 0 ? round2(remaining / daysLeft) : remaining,
      daysLeft,
      daysInMonth: dim,
      elapsed,
      status: budgetStatus,
    },
    anomaly,
    streaks,
    upcoming: {cards: upcomingCards, subscriptions: upcomingSubscriptions, recurring: upcomingRecurring},
    splits: {receivable: splitBlock.receivable, payable: splitBlock.payable, people: splitBlock.people.slice(0, 4)},
    paymentMix,
    topCategories,
    recent,
    emis,
    loans,
    netWorth,
    today: isoDay(today),
  });
}
