import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {
  DAY_MS,
  WEEKDAYS,
  daysInMonth,
  detectSubscriptions,
  monthBuckets,
  parseDay,
  projectMonth,
  startOfDay,
  weekdayIndex,
} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const round = (value: number) => Math.round(value * 100) / 100;
const isoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const params = req.nextUrl.searchParams;
  const requested = Number(params.get('months'));
  const months = requested === 3 || requested === 12 ? requested : 6;
  const now = new Date();
  const today = startOfDay(now);

  const customFrom = parseDay(params.get('from'));
  const customTo = parseDay(params.get('to'));
  const windowStart = customFrom ?? new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
  const windowEnd = customTo ? new Date(customTo.getTime() + DAY_MS - 1) : now;
  const scanStart = new Date(Math.min(windowStart.getTime(), today.getTime() - 190 * DAY_MS));

  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where: {userId: {in: memberIds}, date: {gte: scanStart, lte: windowEnd}},
      include: {category: {select: {id: true, name: true, colorCode: true}}},
      orderBy: {date: 'asc'},
    }),
    prisma.category.findMany({where: {userId: {in: memberIds}}, orderBy: {monthlyBudget: 'desc'}}),
  ]);

  const inWindow = expenses.filter((row) => row.date >= windowStart && row.date <= windowEnd);
  const spendRows = inWindow.filter((row) => row.type !== 'INCOME');
  const income = inWindow.filter((row) => row.type === 'INCOME').reduce((sum, row) => sum + Number(row.amount), 0);
  const spend = spendRows.reduce((sum, row) => sum + Number(row.amount), 0);

  const endOfSpan = startOfDay(windowEnd < today ? windowEnd : today);
  const spanDays = Math.max(1, Math.round((endOfSpan.getTime() - windowStart.getTime()) / DAY_MS) + 1);
  const avgDaily = spend / spanDays;

  // --- biggest spending day -------------------------------------------------
  const perDayAmount = new Map<string, number>();
  for (const row of spendRows) perDayAmount.set(isoDay(row.date), (perDayAmount.get(isoDay(row.date)) ?? 0) + Number(row.amount));
  let biggestDay = {date: '', label: '', amount: 0};
  for (const [date, amount] of perDayAmount) {
    if (amount > biggestDay.amount) {
      const parsed = new Date(`${date}T00:00:00`);
      biggestDay = {date, label: parsed.toLocaleDateString('en-IN', {day: '2-digit', month: 'short'}), amount: round(amount)};
    }
  }

  // --- daily series with a 7-day moving average -----------------------------
  const dailyEnd = endOfSpan;
  const dailyCount = Math.min(60, Math.max(7, spanDays));
  const dailyStart = new Date(dailyEnd.getTime() - (dailyCount - 1) * DAY_MS);
  const daily: {date: string; label: string; amount: number; avg7: number}[] = [];
  for (let index = 0; index < dailyCount; index++) {
    const day = new Date(dailyStart.getTime() + index * DAY_MS);
    daily.push({
      date: isoDay(day),
      label: day.toLocaleDateString('en-IN', {day: '2-digit', month: 'short'}),
      amount: round(perDayAmount.get(isoDay(day)) ?? 0),
      avg7: 0,
    });
  }
  let rolling = 0;
  daily.forEach((point, index) => {
    rolling += point.amount;
    if (index >= 7) rolling -= daily[index - 7].amount;
    point.avg7 = round(rolling / Math.min(index + 1, 7));
  });

  // --- weekday pattern ------------------------------------------------------
  const weekday = WEEKDAYS.map((day) => ({day, amount: 0}));
  for (const row of spendRows) weekday[weekdayIndex(row.date)].amount += Number(row.amount);
  weekday.forEach((bucket) => (bucket.amount = round(bucket.amount)));

  // --- category trend -------------------------------------------------------
  const buckets = monthBuckets(months, now).filter((bucket) => bucket.end > windowStart && bucket.start <= windowEnd);
  const spendByCategory = new Map<string, number>();
  for (const row of spendRows) {
    if (!row.category) continue;
    spendByCategory.set(row.category.id, (spendByCategory.get(row.category.id) ?? 0) + Number(row.amount));
  }
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const topCategories = [...spendByCategory.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .flatMap(([id]) => {
      const category = categoryById.get(id);
      return category ? [category] : [];
    });
  const series = topCategories.map((category) => ({name: category.name, color: category.colorCode}));
  const trendRows = buckets.map((bucket) => {
    const row: Record<string, string | number> = {month: bucket.label};
    for (const category of topCategories) row[category.name] = 0;
    return row;
  });
  for (const row of spendRows) {
    if (!row.category) continue;
    const index = buckets.findIndex((bucket) => row.date >= bucket.start && row.date < bucket.end);
    if (index < 0) continue;
    const categoryId = row.category.id;
    const category = topCategories.find((entry) => entry.id === categoryId);
    if (!category) continue;
    const cell = trendRows[index];
    cell[category.name] = round(Number(cell[category.name]) + Number(row.amount));
  }

  // --- month over month -----------------------------------------------------
  const monthlyBuckets = monthBuckets(months + 1, now);
  const monthly = monthlyBuckets.map((bucket) => {
    const rows = expenses.filter((row) => row.date >= bucket.start && row.date < bucket.end);
    return {
      key: bucket.key,
      label: bucket.label,
      spend: round(rows.filter((row) => row.type !== 'INCOME').reduce((sum, row) => sum + Number(row.amount), 0)),
      income: round(rows.filter((row) => row.type === 'INCOME').reduce((sum, row) => sum + Number(row.amount), 0)),
    };
  });
  const current = monthly[monthly.length - 1];
  // compare like with like: previous month only up to the same day of the month
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevEnd = new Date(now.getFullYear(), now.getMonth(), 1);
  const cutoff = Math.min(now.getDate(), daysInMonth(prevStart.getFullYear(), prevStart.getMonth()));
  const prevComparable = expenses
    .filter(
      (row) =>
        row.type !== 'INCOME' &&
        row.date >= prevStart &&
        row.date < prevEnd &&
        row.date.getDate() <= cutoff,
    )
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const momPct = prevComparable > 0 ? round(((current.spend - prevComparable) / prevComparable) * 100) : 0;

  // --- month vs month breakdown --------------------------------------------
  const prevIncome = expenses
    .filter((row) => row.type === 'INCOME' && row.date >= prevStart && row.date < prevEnd && row.date.getDate() <= cutoff)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const pct = (now_: number, prev: number) => (prev > 0 ? round(((now_ - prev) / prev) * 100) : 0);
  const momMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const momCurrentByCat = new Map<string, number>();
  const momPrevByCat = new Map<string, number>();
  for (const row of expenses) {
    if (row.type === 'INCOME' || !row.category) continue;
    const amount = Number(row.amount);
    if (row.date >= momMonthStart) {
      momCurrentByCat.set(row.category.id, (momCurrentByCat.get(row.category.id) ?? 0) + amount);
    } else if (row.date >= prevStart && row.date < prevEnd && row.date.getDate() <= cutoff) {
      momPrevByCat.set(row.category.id, (momPrevByCat.get(row.category.id) ?? 0) + amount);
    }
  }
  const momCategoryIds = new Set([...momCurrentByCat.keys(), ...momPrevByCat.keys()]);
  const momCategories = [...momCategoryIds]
    .map((id) => {
      const category = categoryById.get(id);
      const currentAmount = round(momCurrentByCat.get(id) ?? 0);
      const previousAmount = round(momPrevByCat.get(id) ?? 0);
      return {
        id,
        name: category?.name ?? '—',
        color: category?.colorCode ?? '#94a3b8',
        current: currentAmount,
        previous: previousAmount,
        pct: pct(currentAmount, previousAmount),
        delta: round(currentAmount - previousAmount),
      };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);
  const mom = {
    spend: {current: round(current.spend), previous: round(prevComparable), pct: momPct},
    income: {current: round(current.income), previous: round(prevIncome), pct: pct(current.income, prevIncome)},
    savings: {
      current: round(current.income - current.spend),
      previous: round(prevIncome - prevComparable),
      pct: pct(current.income - current.spend, prevIncome - prevComparable),
    },
    categories: momCategories,
    cutoff,
  };

  // --- tax-deductible spending (financial year Apr → Mar) --------------------
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyStart = new Date(fyStartYear, 3, 1);
  const fyEnd = new Date(fyStartYear + 1, 3, 1);
  const flaggedIds = new Set(categories.filter((category) => category.taxDeductible).map((category) => category.id));
  const fyRows = await prisma.expense.findMany({
    where: {userId: {in: memberIds}, type: {not: 'INCOME'}, date: {gte: fyStart, lt: fyEnd}},
    select: {amount: true, categoryId: true},
  });
  const taxByCat = new Map<string, number>();
  let taxEligible = 0;
  let taxCount = 0;
  for (const row of fyRows) {
    if (!row.categoryId || !flaggedIds.has(row.categoryId)) continue;
    taxCount += 1;
    taxEligible += Number(row.amount);
    taxByCat.set(row.categoryId, (taxByCat.get(row.categoryId) ?? 0) + Number(row.amount));
  }
  const tax = {
    fy: `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`,
    eligible: round(taxEligible),
    count: taxCount,
    flagged: flaggedIds.size,
    byCategory: [...taxByCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .flatMap(([id, amount]) => {
        const category = categoryById.get(id);
        return category ? [{id, name: category.name, color: category.colorCode, amount: round(amount)}] : [];
      }),
  };

  // --- month-end forecast ---------------------------------------------------
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const elapsed = Math.max(1, now.getDate());
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const spentThisMonth = new Map<string, number>();
  const trailing30 = new Map<string, number>();
  const trailStart = new Date(today.getTime() - 30 * DAY_MS);
  for (const row of expenses) {
    if (row.type === 'INCOME' || !row.category) continue;
    if (row.date >= monthStart) {
      spentThisMonth.set(row.category.id, (spentThisMonth.get(row.category.id) ?? 0) + Number(row.amount));
    }
    if (row.date >= trailStart) {
      trailing30.set(row.category.id, (trailing30.get(row.category.id) ?? 0) + Number(row.amount));
    }
  }
  const forecast = categories
    .map((category) => {
      const budget = Number(category.monthlyBudget);
      const spent = round(spentThisMonth.get(category.id) ?? 0);
      const projected = projectMonth(trailing30.get(category.id) ?? 0, spent, elapsed, dim);
      const status = budget <= 0 ? 'no-budget' : projected > budget ? 'over' : projected > budget * 0.9 ? 'watch' : 'on-track';
      return {id: category.id, name: category.name, color: category.colorCode, budget, spent, projected, status};
    })
    .filter((row) => row.budget > 0 || row.spent > 0)
    .sort((a, b) => b.budget - a.budget || b.projected - a.projected);
  const forecastTotal = round(forecast.reduce((sum, row) => sum + row.projected, 0));

  // --- recurring subscriptions ---------------------------------------------
  const recurringRows = expenses.flatMap((row) =>
    row.type !== 'INCOME' && row.category
      ? [{date: row.date, amount: Number(row.amount), description: row.description, categoryId: row.category.id}]
      : [],
  );
  const subscriptions = detectSubscriptions(recurringRows, now);
  const commitment = round(subscriptions.reduce((sum, row) => sum + row.amount, 0));

  // --- biggest transactions -------------------------------------------------
  const topExpenses = [...spendRows]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 8)
    .map((row) => ({
      id: row.id,
      description: row.description,
      amount: round(Number(row.amount)),
      date: isoDay(row.date),
      category: row.category?.name ?? '—',
      color: row.category?.colorCode ?? '#94a3b8',
      method: row.paymentMethod,
    }));

  return NextResponse.json({
    window: {start: isoDay(windowStart), end: isoDay(windowEnd), months},
    totals: {
      spend: round(spend),
      income: round(income),
      savings: round(income - spend),
      avgDaily: round(avgDaily),
      count: spendRows.length,
      biggestDay,
      momPct,
      forecastTotal,
      commitment,
      weekdayTop: weekday.reduce((best, item) => (item.amount > best.amount ? item : best), weekday[0]).day,
    },
    daily,
    weekday,
    categoryTrend: {series, rows: trendRows},
    monthly,
    forecast,
    forecastMeta: {elapsed, daysInMonth: dim, daysLeft: dim - now.getDate()},
    subscriptions,
    topExpenses,
    mom,
    tax,
  });
}
