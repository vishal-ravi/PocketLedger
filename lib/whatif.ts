import {round2} from '@/lib/analytics';

export type WhatIfResult = {
  spendAfter: number;
  savingsBefore: number;
  savingsAfter: number;
  savingsRatePct: number;
  yearlySavings: number;
  deltaYearly: number;
};

/**
 * Models the effect of cutting spend and setting extra money aside each month.
 * `cutPct` (0-100) reduces spending, `extraSaving` reduces the amount left to
 * spend after that cut (both therefore increase savings).
 */
export function whatIf(input: {income: number; spend: number; cutPct: number; extraSaving: number}): WhatIfResult {
  const income = Math.max(0, Number(input.income));
  const spend = Math.max(0, Number(input.spend));
  const cut = Math.min(100, Math.max(0, Number(input.cutPct)));
  const extra = Math.max(0, Number(input.extraSaving));

  const savingsBefore = round2(income - spend);
  const spendAfter = round2(Math.max(0, spend * (1 - cut / 100) - extra));
  const savingsAfter = round2(income - spendAfter);
  return {
    spendAfter,
    savingsBefore,
    savingsAfter,
    savingsRatePct: income > 0 ? round2((savingsAfter / income) * 100) : 0,
    yearlySavings: round2(savingsAfter * 12),
    deltaYearly: round2((savingsAfter - savingsBefore) * 12),
  };
}
