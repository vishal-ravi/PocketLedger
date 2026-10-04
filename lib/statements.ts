import {isoDay} from '@/lib/analytics';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const pad = (value: number) => String(value).padStart(2, '0');

export function isMonth(value: string | null | undefined): value is string {
  return typeof value === 'string' && MONTH_RE.test(value);
}

/** [from, to) covering a calendar month in local time (matches how transactions are stored). */
export function parseMonth(month: string | null | undefined): {from: Date; to: Date} | null {
  if (!isMonth(month)) return null;
  const [year, monthOfYear] = month.split('-').map(Number);
  return {from: new Date(year, monthOfYear - 1, 1), to: new Date(year, monthOfYear, 1)};
}

export function monthLabel(month: string): string {
  const [year, monthOfYear] = month.split('-').map(Number);
  return new Date(year, monthOfYear - 1, 1).toLocaleDateString('en-IN', {month: 'long', year: 'numeric'});
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthOfYear] = month.split('-').map(Number);
  const shifted = new Date(year, monthOfYear - 1 + delta, 1);
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}`;
}

export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

export type StatementRow = {
  date: Date;
  amount: number;
  type: string;
  categoryName: string | null;
};

export type CategoryLine = {name: string; amount: number; count: number};

export type StatementSummary = {
  income: number;
  spent: number;
  net: number;
  count: number;
  byCategory: CategoryLine[];
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function summarise(rows: StatementRow[]): StatementSummary {
  let income = 0;
  let spent = 0;
  const byName = new Map<string, CategoryLine>();
  for (const row of rows) {
    if (row.type === 'INCOME') {
      income = round2(income + row.amount);
    } else {
      spent = round2(spent + row.amount);
      const name = row.categoryName ?? 'Uncategorised';
      const line = byName.get(name) ?? {name, amount: 0, count: 0};
      line.amount = round2(line.amount + row.amount);
      line.count += 1;
      byName.set(name, line);
    }
  }
  const byCategory = [...byName.values()].sort((a, b) => b.amount - a.amount);
  return {income, spent, net: round2(income - spent), count: rows.length, byCategory};
}

export function statementRangeLabel(from: Date, to: Date): string {
  const end = new Date(to.getTime() - 1);
  return `${isoDay(from)} – ${isoDay(end)}`;
}
