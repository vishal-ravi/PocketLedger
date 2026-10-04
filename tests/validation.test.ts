import {test} from 'node:test';
import assert from 'node:assert/strict';
import {splitTotals} from '../lib/debts';
import {expenseSchema, loanSchema, validate} from '../lib/validation';
import {hashToken} from '../lib/tokens';

test('splitTotals nets balances between people', () => {
  const totals = splitTotals([
    {personName: 'Amit', amountOwedToMe: 200, amountIOwe: 0, status: 'PENDING'},
    {personName: 'Amit', amountOwedToMe: 0, amountIOwe: 150, status: 'PENDING'},
    {personName: 'Ravi', amountOwedToMe: 60, amountIOwe: 60, status: 'PENDING'},
  ]);
  assert.equal(totals.receivable, 260);
  assert.equal(totals.payable, 210);

  const amit = totals.people.find((p) => p.name === 'Amit');
  assert.ok(amit, 'Amit should appear in balances');
  assert.equal(amit.owed, 200);
  assert.equal(amit.owe, 150);
  assert.equal(amit.balance, 50);
  // net-zero people are filtered out
  assert.equal(totals.people.find((p) => p.name === 'Ravi'), undefined);
  // sorted by balance descending
  assert.equal(totals.people[0].name, 'Amit');
});

test('validate returns typed data on success', () => {
  const result = validate(expenseSchema, {
    date: '2026-10-05',
    categoryId: '00000000-0000-0000-0000-000000000001',
    description: 'Lunch',
    paymentMethod: 'UPI',
    amount: 250,
    type: 'NEED',
  });
  assert.ok('data' in result);
  assert.equal(result.data.amount, 250);
  assert.equal(result.data.date.getFullYear(), 2026);
});

test('validate reports a readable error on failure', () => {
  const result = validate(expenseSchema, {description: ''});
  assert.ok('error' in result);
  assert.ok(result.error.length > 0);
});

test('loanSchema rejects bad tenure', () => {
  const result = validate(loanSchema, {
    lenderName: 'Bank',
    principal: 100000,
    annualRate: 10,
    tenureMonths: 0,
    emiAmount: 1000,
    startDate: '2026-10-01',
  });
  assert.ok('error' in result);
});

test('hashToken is deterministic, case-sensitive and hex', () => {
  const a = hashToken('abc-123');
  assert.equal(a, hashToken('abc-123'));
  assert.notEqual(a, hashToken('ABC-123'));
  assert.match(a, /^[0-9a-f]{64}$/);
});
