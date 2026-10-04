import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  currentMonth,
  isMonth,
  monthLabel,
  parseMonth,
  shiftMonth,
  statementRangeLabel,
  summarise,
} from '../lib/statements';

test('parseMonth accepts valid months and rejects junk', () => {
  assert.equal(isMonth('2026-10'), true);
  assert.equal(isMonth('2026-1'), false);
  assert.equal(isMonth('2026-13'), false);
  assert.equal(isMonth('oct-2026'), false);
  assert.equal(isMonth(null), false);
  assert.equal(parseMonth('2026-10-01'), null);

  const range = parseMonth('2026-10')!;
  assert.equal(range.from.getFullYear(), 2026);
  assert.equal(range.from.getMonth(), 9);
  assert.equal(range.from.getDate(), 1);
  assert.equal(range.to.getFullYear(), 2026);
  assert.equal(range.to.getMonth(), 10);
  assert.equal(range.to.getDate(), 1);
});

test('parseMonth spans year boundaries', () => {
  const range = parseMonth('2025-12')!;
  assert.equal(range.from.getMonth(), 11);
  assert.equal(range.to.getFullYear(), 2026);
  assert.equal(range.to.getMonth(), 0);
});

test('shiftMonth walks backwards and forwards across years', () => {
  assert.equal(shiftMonth('2026-10', -1), '2026-09');
  assert.equal(shiftMonth('2026-10', 1), '2026-11');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2025-12', 1), '2026-01');
  assert.equal(shiftMonth('2026-10', -22), '2024-12');
});

test('monthLabel reads naturally in en-IN', () => {
  assert.equal(monthLabel('2026-10'), 'October 2026');
  assert.equal(monthLabel('2025-12'), 'December 2025');
  assert.match(currentMonth(), /^\d{4}-(0[1-9]|1[0-2])$/);
});

test('statementRangeLabel covers the full month', () => {
  const range = parseMonth('2026-10')!;
  assert.equal(statementRangeLabel(range.from, range.to), '2026-10-01 – 2026-10-31');
});

test('summarise splits income from spending and ranks categories', () => {
  const rows = [
    {date: new Date(2026, 9, 1), amount: 1000, type: 'INCOME', categoryName: 'Salary'},
    {date: new Date(2026, 9, 2), amount: 120, type: 'NEED', categoryName: 'Groceries'},
    {date: new Date(2026, 9, 3), amount: 80.5, type: 'NEED', categoryName: 'Groceries'},
    {date: new Date(2026, 9, 4), amount: 200, type: 'WANT', categoryName: 'Fun'},
    {date: new Date(2026, 9, 5), amount: 50, type: 'WANT', categoryName: null},
  ];
  const summary = summarise(rows);
  assert.equal(summary.income, 1000);
  assert.equal(summary.spent, 450.5);
  assert.equal(summary.net, 549.5);
  assert.equal(summary.count, 5);
  assert.deepEqual(
    summary.byCategory.map((line) => [line.name, line.amount, line.count]),
    [
      ['Groceries', 200.5, 2],
      ['Fun', 200, 1],
      ['Uncategorised', 50, 1],
    ],
  );
});

test('summarise of an empty month is all zeroes', () => {
  const summary = summarise([]);
  assert.deepEqual(summary, {income: 0, spent: 0, net: 0, count: 0, byCategory: []});
});
