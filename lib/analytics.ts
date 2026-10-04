export const DAY_MS = 86_400_000;

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(key: string, long = false) {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleString('en-IN', {month: long ? 'long' : 'short'});
}

export function daysInMonth(year: number, monthIndex: number) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

/** The date for a day-of-month inside a given month, clamped to that month's length. */
export function dayOccurrence(day: number, year: number, monthIndex: number) {
  return new Date(year, monthIndex, Math.min(Math.max(1, day), daysInMonth(year, monthIndex)));
}

/** The first occurrence of `day` that is today or later (clamped for short months). */
export function nextOccurrence(day: number, from = new Date()) {
  const today = startOfDay(from);
  const thisMonth = dayOccurrence(day, today.getFullYear(), today.getMonth());
  if (thisMonth.getTime() >= today.getTime()) return thisMonth;
  return dayOccurrence(day, today.getFullYear(), today.getMonth() + 1);
}

export function daysUntil(target: Date, from = new Date()) {
  return Math.round((startOfDay(target).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

/**
 * Current billing cycle for a card: from the most recent statement generation
 * day up to the next one.
 */
export function billingCycle(statementDay: number, from = new Date()) {
  const today = startOfDay(from);
  let start = dayOccurrence(statementDay, today.getFullYear(), today.getMonth());
  if (start.getTime() > today.getTime()) start = dayOccurrence(statementDay, today.getFullYear(), today.getMonth() - 1);
  let end = dayOccurrence(statementDay, start.getFullYear(), start.getMonth() + 1);
  if (end.getTime() <= start.getTime()) end = dayOccurrence(statementDay, start.getFullYear(), start.getMonth() + 2);
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / DAY_MS));
  const elapsed = Math.min(totalDays, Math.max(0, Math.round((today.getTime() - start.getTime()) / DAY_MS)));
  return {start, end, totalDays, elapsed, daysLeft: totalDays - elapsed};
}

/** The last `count` month buckets ending with the current month. */
export function monthBuckets(count: number, from = new Date()) {
  const buckets: {key: string; label: string; start: Date; end: Date}[] = [];
  for (let index = count - 1; index >= 0; index--) {
    const start = new Date(from.getFullYear(), from.getMonth() - index, 1);
    buckets.push({
      key: monthKey(start),
      label: monthLabel(monthKey(start)),
      start,
      end: new Date(start.getFullYear(), start.getMonth() + 1, 1),
    });
  }
  return buckets;
}

export function daysBetween(from: Date, to: Date) {
  return Math.max(1, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS));
}

export function parseDay(value: string | null): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function weekdayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}

/** Collapse a description so "Netflix ₹149" and "netflix plan 159" group together. */
export function normalizeDescription(description: string) {
  return description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b\d+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type RecurringRow = {
  date: Date;
  amount: number;
  description: string;
  categoryId: string;
};

export type Subscription = {
  name: string;
  amount: number;
  occurrences: number;
  lastDate: Date;
  gapDays: number;
  nextDue: Date;
  categoryId: string;
};

/** Finds charges that repeat on an roughly monthly cadence with a stable amount. */
export function detectSubscriptions(rows: RecurringRow[], now = new Date()): Subscription[] {
  const groups = new Map<string, RecurringRow[]>();
  for (const row of rows) {
    if (row.amount <= 0) continue;
    const key = `${row.categoryId}|${normalizeDescription(row.description)}`;
    if (key.length < 6) continue;
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }

  const found: Subscription[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 3) continue;
    const entries = [...bucket].sort((a, b) => a.date.getTime() - b.date.getTime());
    if (entries.length < 4) continue;
    const gaps: number[] = [];
    for (let i = 1; i < entries.length; i++) {
      gaps.push(Math.round((entries[i].date.getTime() - entries[i - 1].date.getTime()) / DAY_MS));
    }
    const sortedGaps = [...gaps].sort((a, b) => a - b);
    const medianGap = sortedGaps[Math.floor(sortedGaps.length / 2)];
    if (medianGap < 25 || medianGap > 36) continue;
    if (sortedGaps[sortedGaps.length - 1] - sortedGaps[0] > 12) continue;

    const months = new Set(entries.map((entry) => monthKey(entry.date)));
    if (months.size < 4) continue;

    const amounts = entries.map((entry) => entry.amount);
    const max = Math.max(...amounts);
    const min = Math.min(...amounts);
    if ((max - min) / Math.max(1, max) > 0.45) continue;

    const last = entries[entries.length - 1];
    const avg = amounts.reduce((sum, value) => sum + value, 0) / amounts.length;
    const nextDue = new Date(last.date.getTime() + medianGap * DAY_MS);
    if (nextDue.getTime() < startOfDay(now).getTime() - 45 * DAY_MS) continue;

    found.push({
      name: last.description,
      amount: Math.round(avg * 100) / 100,
      occurrences: entries.length,
      lastDate: last.date,
      gapDays: medianGap,
      nextDue,
      categoryId: last.categoryId,
    });
  }

  return found.sort((a, b) => b.amount - a.amount);
}

export type UtilisationBand = 'excellent' | 'good' | 'fair' | 'high';

export function bandFor(pct: number): UtilisationBand {
  if (pct <= 30) return 'excellent';
  if (pct <= 50) return 'good';
  if (pct <= 75) return 'fair';
  return 'high';
}

export const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Projected spend for the whole month. Prefers a trailing-30-day run rate
 * (stable early in the month) and falls back to a day-based burn rate.
 */
export function projectMonth(trailing30: number, monthToDate: number, elapsed: number, dim: number) {
  const runRate = (trailing30 / 30) * dim;
  if (runRate > 0) return round2(runRate);
  return elapsed > 0 ? round2((monthToDate / elapsed) * dim) : 0;
}

export const isoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export type SummaryRow = {type: string; amount: number; category: string};

/** Month aggregates shared by the summary and dashboard endpoints. */
export function summarize(rows: SummaryRow[], days: number) {
  const income = rows.filter((row) => row.type === 'INCOME').reduce((sum, row) => sum + row.amount, 0);
  const out = rows.filter((row) => row.type !== 'INCOME').reduce((sum, row) => sum + row.amount, 0);
  const needs = rows.filter((row) => row.type === 'NEED').reduce((sum, row) => sum + row.amount, 0);
  const wants = rows.filter((row) => row.type === 'WANT').reduce((sum, row) => sum + row.amount, 0);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.type === 'INCOME') continue;
    counts.set(row.category, (counts.get(row.category) ?? 0) + row.amount);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || 'None';
  return {
    income: round2(income),
    expenses: round2(out),
    savings: round2(income - out),
    savingsRate: income ? round2(((income - out) / income) * 100) : 0,
    dailyAverage: round2(out / Math.max(1, days)),
    needs: round2(needs),
    wants: round2(wants),
    topCategory: top,
  };
}

/**
 * Walks backwards from `today` over a per-day spend map (missing days = zero).
 * Returns the current zero-spend streak and the days-in-a-row under `cap`.
 */
export function streaksFor(daily: Map<string, number>, today: Date, cap: number) {
  const spendOn = (back: number) =>
    daily.get(isoDay(new Date(today.getFullYear(), today.getMonth(), today.getDate() - back))) ?? 0;

  let noSpendDays = 0;
  if (spendOn(0) === 0) {
    for (let back = 0; back < 400 && spendOn(back) === 0; back++) noSpendDays++;
  }

  let underBudgetDays = 0;
  if (cap > 0) {
    for (let back = 0; back < 400 && spendOn(back) <= cap; back++) underBudgetDays++;
  }

  return {noSpendDays, underBudgetDays};
}
