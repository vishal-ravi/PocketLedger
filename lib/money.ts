export function formatMoney(amount: number | string | null | undefined, symbol = '₹') {
  const value = typeof amount === 'string' ? Number(amount) : (amount ?? 0);
  if (!Number.isFinite(value)) return `${symbol}0`;
  const rounded = Math.round(value * 100) / 100;
  return `${symbol}${rounded.toLocaleString('en-IN', {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

export const todayLocal = () => {
  const date = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export const formatDate = (value: string | Date) =>
  new Date(value).toLocaleDateString('en-IN', {day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'});
