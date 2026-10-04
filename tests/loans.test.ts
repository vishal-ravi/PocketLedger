import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildSchedule, computeEmi, dueDateFor, toLoanDto} from '../lib/loans';

test('computeEmi: zero-rate loan splits evenly', () => {
  assert.equal(computeEmi(120000, 0, 12), 10000);
});

test('computeEmi: declining-balance EMI matches the standard formula', () => {
  const emi = computeEmi(100000, 12, 24);
  const r = 0.12 / 12;
  const expected = (100000 * r * Math.pow(1 + r, 24)) / (Math.pow(1 + r, 24) - 1);
  assert.ok(Math.abs(emi - expected) < 0.01);
  assert.ok(emi > 4700 && emi < 4800);
});

test('computeEmi guards degenerate inputs', () => {
  assert.equal(computeEmi(100000, 12, 0), 0);
  assert.equal(computeEmi(0, 12, 12), 0);
});

test('dueDateFor keeps day-of-month, clamped in short months', () => {
  const start = new Date(Date.UTC(2026, 0, 31));
  assert.equal(dueDateFor(start, 0).toISOString().slice(0, 10), '2026-01-31');
  assert.equal(dueDateFor(start, 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(dueDateFor(start, 2).toISOString().slice(0, 10), '2026-03-31');
});

test('buildSchedule: count, numbering, totals and rounding tail', () => {
  const schedule = buildSchedule(new Date(Date.UTC(2026, 0, 5)), 12, 8333.33);
  assert.equal(schedule.length, 12);
  assert.deepEqual(
    schedule.map((s) => s.number),
    Array.from({length: 12}, (_, i) => i + 1),
  );
  const total = schedule.reduce((sum, s) => sum + s.amount, 0);
  assert.equal(Math.round(total * 100), Math.round(8333.33 * 12 * 100));
  // last instalment absorbs rounding drift
  const last = schedule[schedule.length - 1];
  assert.ok(last.amount > 8332 && last.amount < 8335);
});

test('toLoanDto aggregates paid/due/overdue and picks next due', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const loan = {
    id: 'l1',
    lenderName: 'Bank',
    principal: 100000,
    annualRate: 10,
    tenureMonths: 3,
    emiAmount: 33333.33,
    startDate: new Date('2026-07-01T00:00:00Z'),
    categoryId: null,
    creditCardId: null,
    paymentMethod: 'UPI',
    notes: null,
    installments: [
      {id: 'i1', number: 1, dueDate: new Date('2026-07-01T00:00:00Z'), amount: 33333.33, paidDate: new Date('2026-07-01T00:00:00Z'), expenseId: null, status: 'PAID' as const},
      {id: 'i2', number: 2, dueDate: new Date('2026-08-01T00:00:00Z'), amount: 33333.33, paidDate: null, expenseId: null, status: 'DUE' as const},
      {id: 'i3', number: 3, dueDate: new Date('2026-09-01T00:00:00Z'), amount: 33333.33, paidDate: null, expenseId: null, status: 'DUE' as const},
    ],
  };
  const dto = toLoanDto(loan, now);
  assert.equal(dto.paidCount, 1);
  assert.equal(dto.dueCount, 2);
  assert.equal(dto.overdueCount, 2); // both due dates are before 10 Oct
  assert.equal(dto.paidAmount, 33333.33);
  assert.equal(dto.outstanding, 66666.66);
  assert.equal(dto.progress, 33.33);
  assert.equal(dto.nextDue?.id, 'i2');
});
