import {test} from 'node:test';
import assert from 'node:assert/strict';
import {convertToBase, formatFxNote, fxIssue, hasFx} from '../lib/fx';
import {expenseSchema} from '../lib/validation';

const base = {
  date: '2026-10-03',
  description: 'Hotel in Bangkok',
  categoryId: '22222222-2222-2222-2222-222222222222',
  paymentMethod: 'CREDIT_CARD',
  amount: 8350,
  type: 'NEED',
};

test('convertToBase multiplies and rounds to 2 decimals', () => {
  assert.equal(convertToBase(100, 83.5), 8350);
  assert.equal(convertToBase(33.33, 3), 99.99);
  assert.equal(convertToBase(9.99, 0.91), 9.09);
});

test('fxIssue accepts a complete trio and empty input', () => {
  assert.equal(fxIssue({originalCurrency: 'USD', originalAmount: 100, fxRate: 83.5}), null);
  assert.equal(fxIssue({}), null);
  assert.equal(fxIssue({originalCurrency: null, originalAmount: null, fxRate: null}), null);
});

test('fxIssue rejects partial or invalid fx data', () => {
  assert.match(String(fxIssue({originalCurrency: 'USD'})), /original amount/);
  assert.match(String(fxIssue({originalAmount: 100, fxRate: 83.5})), /currency is required/);
  assert.match(String(fxIssue({originalCurrency: 'USD', originalAmount: 100, fxRate: 0})), /fx rate/);
  assert.match(String(fxIssue({originalCurrency: 'US', originalAmount: 100, fxRate: 83.5})), /3-letter/);
});

test('hasFx treats null, undefined and empty string as absent', () => {
  assert.equal(hasFx(null), false);
  assert.equal(hasFx(undefined), false);
  assert.equal(hasFx(''), false);
  assert.equal(hasFx(0), true);
});

test('expenseSchema keeps a valid fx trio', () => {
  const result = expenseSchema.safeParse({...base, originalCurrency: 'usd', originalAmount: 100, fxRate: 83.5});
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.originalCurrency, 'USD');
    assert.equal(result.data.originalAmount, 100);
    assert.equal(result.data.fxRate, 83.5);
  }
});

test('expenseSchema rejects an incomplete fx trio', () => {
  const result = expenseSchema.safeParse({...base, originalCurrency: 'USD', originalAmount: 100});
  assert.equal(result.success, false);
  if (!result.success) assert.match(result.error.issues[0].message, /fx rate/);
});

test('expenseSchema still strips unknown fx-less expenses', () => {
  const result = expenseSchema.safeParse(base);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.originalCurrency, undefined);
    assert.equal(result.data.fxRate, undefined);
  }
});

test('formatFxNote shows the conversion', () => {
  const note = formatFxNote(100, 'USD', 83.5, '₹');
  assert.match(note, /USD 100 @ 83\.5/);
  assert.match(note, /₹8,350/);
});
