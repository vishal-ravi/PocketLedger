import {daysUntil} from '@/lib/analytics';

export type Interval = 'WEEKLY' | 'MONTHLY' | 'YEARLY';

/** Calendar day of a UTC-midnight rule date, e.g. `2026-10-05`. */
export function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Today's calendar date in the user's timezone (`2026-10-05`). */
export function todayKey(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** One interval after `from`, clamping the day-of-month (31 Jan → 28 Feb). */
export function addInterval(from: Date, interval: Interval): Date {
  if (interval === 'WEEKLY') {
    const next = new Date(from);
    next.setUTCDate(next.getUTCDate() + 7);
    return next;
  }
  const months = interval === 'YEARLY' ? 12 : 1;
  const year = from.getUTCFullYear();
  const month = from.getUTCMonth() + months;
  const day = from.getUTCDate();
  const anchor = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
  anchor.setUTCDate(Math.min(day, lastDay));
  return anchor;
}

export type CatchUpResult = {
  /** Occurrences whose scheduled day is today or earlier (post these). */
  due: Date[];
  /** First scheduled day after today, or null when the rule ended. */
  nextDue: Date | null;
};

/**
 * Walk a rule's schedule from `nextDueDate` up to `today`.
 * `maxIterations` caps runaway schedules (e.g. a weekly rule left alone for years).
 */
export function catchUp(
  rule: {nextDueDate: Date; interval: Interval; endDate?: Date | null},
  now: Date,
  maxIterations = 120,
): CatchUpResult {
  const today = todayKey(now);
  const end = rule.endDate ? dateKey(rule.endDate) : null;
  const due: Date[] = [];
  let next = new Date(rule.nextDueDate);

  for (let i = 0; i < maxIterations; i++) {
    const key = dateKey(next);
    if (end && key > end) return {due, nextDue: null};
    if (key > today) return {due, nextDue: next};
    due.push(next);
    next = addInterval(next, rule.interval);
  }
  return {due, nextDue: next};
}

export function formatInterval(interval: Interval): string {
  return interval === 'WEEKLY' ? 'weekly' : interval === 'YEARLY' ? 'yearly' : 'monthly';
}

export type RecurringDto = {
  id: string;
  description: string;
  amount: number;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  creditCardId: string | null;
  cardName: string | null;
  paymentMethod: string;
  interval: Interval;
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  autoPost: boolean;
  paused: boolean;
  notes: string | null;
  daysToDue: number;
  overdue: boolean;
};

export type RecurringRow = {
  id: string;
  description: string;
  amount: unknown;
  type: string;
  categoryId: string | null;
  paymentMethod: string;
  creditCardId: string | null;
  interval: string;
  startDate: Date;
  nextDueDate: Date;
  endDate: Date | null;
  autoPost: boolean;
  paused: boolean;
  notes: string | null;
  category?: {name: string} | null;
  creditCard?: {cardName: string} | null;
};

export function toRecurringDto(rule: RecurringRow, now = new Date()): RecurringDto {
  const daysToDue = daysUntil(rule.nextDueDate, now);
  return {
    id: rule.id,
    description: rule.description,
    amount: Number(rule.amount),
    type: rule.type,
    categoryId: rule.categoryId,
    categoryName: rule.category?.name ?? null,
    creditCardId: rule.creditCardId,
    cardName: rule.creditCard?.cardName ?? null,
    paymentMethod: rule.paymentMethod,
    interval: rule.interval as Interval,
    startDate: dateKey(rule.startDate),
    nextDueDate: dateKey(rule.nextDueDate),
    endDate: rule.endDate ? dateKey(rule.endDate) : null,
    autoPost: rule.autoPost,
    paused: rule.paused,
    notes: rule.notes,
    daysToDue,
    overdue: !rule.paused && daysToDue < 0,
  };
}
