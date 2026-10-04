import {round2} from '@/lib/analytics';

export const FX_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'SGD', 'AUD', 'CAD', 'JPY'] as const;

export type FxInput = {
  originalCurrency?: string | null;
  originalAmount?: number | string | null;
  fxRate?: number | string | null;
};

export function convertToBase(originalAmount: number | string, fxRate: number | string): number {
  return round2(Number(originalAmount) * Number(fxRate));
}

export function hasFx(value: unknown): boolean {
  return value !== undefined && value !== null && value !== '';
}

/** Error message when the original-currency trio is incomplete or invalid, else null. */
export function fxIssue(input: FxInput): string | null {
  const anyPresent = hasFx(input.originalCurrency) || hasFx(input.originalAmount) || hasFx(input.fxRate);
  if (!anyPresent) return null;
  if (!hasFx(input.originalCurrency)) return 'original currency is required with an fx rate';
  if (!hasFx(input.originalAmount) || Number(input.originalAmount) <= 0) {
    return 'original amount must be greater than 0 when a currency is set';
  }
  if (!hasFx(input.fxRate) || Number(input.fxRate) <= 0) return 'fx rate must be greater than 0 when a currency is set';
  if (!/^[A-Za-z]{3}$/.test(String(input.originalCurrency))) return 'currency must be a 3-letter code like USD';
  return null;
}

export function formatFxNote(
  originalAmount: number | string,
  currency: string,
  fxRate: number | string,
  symbol = '₹',
): string {
  const amount = Number(originalAmount);
  const rate = Number(fxRate);
  const base = convertToBase(originalAmount, fxRate);
  return `${currency} ${amount.toLocaleString('en-IN', {maximumFractionDigits: 2})} @ ${rate} → ${symbol}${base.toLocaleString('en-IN', {maximumFractionDigits: 2})}`;
}
