import {round2, daysUntil} from '@/lib/analytics';

type InstallmentRow = {
  id: string;
  number: number;
  dueDate: Date;
  amount: unknown;
  paidDate: Date | null;
  expenseId: string | null;
  status: 'DUE' | 'PAID';
};

export type LoanDto = {
  id: string;
  lenderName: string;
  principal: number;
  annualRate: number;
  tenureMonths: number;
  emiAmount: number;
  startDate: string;
  categoryId: string | null;
  creditCardId: string | null;
  paymentMethod: string;
  notes: string | null;
  paidCount: number;
  dueCount: number;
  overdueCount: number;
  paidAmount: number;
  outstanding: number;
  progress: number;
  nextDue: {id: string; number: number; dueDate: string; amount: number; daysToDue: number} | null;
};

/** Equated monthly instalment for a declining-balance loan. */
export function computeEmi(principal: number, annualRate: number, tenureMonths: number) {
  if (tenureMonths <= 0 || principal <= 0) return 0;
  const rate = annualRate / 12 / 100;
  if (rate === 0) return principal / tenureMonths;
  const factor = Math.pow(1 + rate, tenureMonths);
  return (principal * rate * factor) / (factor - 1);
}

/**
 * Same day-of-month as `date`, clamped to the target month's length.
 * Built with `Date.UTC` because every other date in the API round-trips through
 * `toISOString()` — a local-midnight Date would serialise as the previous day.
 */
export function dueDateFor(startDate: Date, index: number) {
  const day = startDate.getUTCDate();
  const year = startDate.getUTCFullYear();
  const month = startDate.getUTCMonth() + index;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay)));
}

/** `tenureMonths` instalments starting in `startDate`'s month; the last absorbs rounding. */
export function buildSchedule(startDate: Date, tenureMonths: number, emiAmount: number) {
  const instalments: {number: number; dueDate: Date; amount: number}[] = [];
  const total = round2(emiAmount * tenureMonths);
  for (let i = 0; i < tenureMonths; i++) {
    const amount = i === tenureMonths - 1 ? round2(total - emiAmount * (tenureMonths - 1)) : round2(emiAmount);
    instalments.push({number: i + 1, dueDate: dueDateFor(startDate, i), amount});
  }
  return instalments;
}

type LoanRow = {
  id: string;
  lenderName: string;
  principal: unknown;
  annualRate: unknown;
  tenureMonths: number;
  emiAmount: unknown;
  startDate: Date;
  categoryId: string | null;
  creditCardId: string | null;
  paymentMethod: string;
  notes: string | null;
  installments: InstallmentRow[];
};

export function toLoanDto(loan: LoanRow, now = new Date()): LoanDto {
  const paid = loan.installments.filter((row) => row.status === 'PAID');
  const due = loan.installments.filter((row) => row.status === 'DUE');
  const paidAmount = paid.reduce((sum, row) => sum + Number(row.amount), 0);
  const outstanding = due.reduce((sum, row) => sum + Number(row.amount), 0);
  const overdue = due.filter((row) => row.dueDate < now);
  const next = [...due].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];

  return {
    id: loan.id,
    lenderName: loan.lenderName,
    principal: Number(loan.principal),
    annualRate: Number(loan.annualRate),
    tenureMonths: loan.tenureMonths,
    emiAmount: Number(loan.emiAmount),
    startDate: loan.startDate.toISOString().slice(0, 10),
    categoryId: loan.categoryId,
    creditCardId: loan.creditCardId,
    paymentMethod: loan.paymentMethod,
    notes: loan.notes,
    paidCount: paid.length,
    dueCount: due.length,
    overdueCount: overdue.length,
    paidAmount: round2(paidAmount),
    outstanding: round2(outstanding),
    progress: loan.installments.length ? round2((paid.length / loan.installments.length) * 100) : 0,
    nextDue: next
      ? {
          id: next.id,
          number: next.number,
          dueDate: next.dueDate.toISOString().slice(0, 10),
          amount: Number(next.amount),
          daysToDue: daysUntil(next.dueDate, now),
        }
      : null,
  };
}
