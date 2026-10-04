import {test} from 'node:test';
import assert from 'node:assert/strict';
import {whatIf} from '../lib/whatif';

test('whatIf with no changes matches the baseline', () => {
  const result = whatIf({income: 100000, spend: 70000, cutPct: 0, extraSaving: 0});
  assert.equal(result.spendAfter, 70000);
  assert.equal(result.savingsBefore, 30000);
  assert.equal(result.savingsAfter, 30000);
  assert.equal(result.deltaYearly, 0);
  assert.equal(result.savingsRatePct, 30);
});

test('whatIf applies the spending cut', () => {
  const result = whatIf({income: 100000, spend: 70000, cutPct: 20, extraSaving: 0});
  assert.equal(result.spendAfter, 56000);
  assert.equal(result.savingsAfter, 44000);
  assert.equal(result.yearlySavings, 528000);
  assert.equal(result.deltaYearly, 168000);
  assert.equal(result.savingsRatePct, 44);
});

test('whatIf adds the extra monthly saving on top of the cut', () => {
  const result = whatIf({income: 100000, spend: 70000, cutPct: 10, extraSaving: 5000});
  assert.equal(result.spendAfter, 58000);
  assert.equal(result.savingsAfter, 42000);
  assert.equal(result.savingsRatePct, 42);
});

test('whatIf clamps silly inputs', () => {
  const huge = whatIf({income: 100000, spend: 70000, cutPct: 400, extraSaving: 999999});
  assert.equal(huge.spendAfter, 0);
  const negative = whatIf({income: -10, spend: -100, cutPct: -5, extraSaving: -1});
  assert.equal(negative.spendAfter, 0);
  assert.equal(negative.savingsAfter, 0);
});

test('whatIf handles zero income', () => {
  const result = whatIf({income: 0, spend: 5000, cutPct: 50, extraSaving: 0});
  assert.equal(result.savingsRatePct, 0);
  assert.equal(result.spendAfter, 2500);
});
