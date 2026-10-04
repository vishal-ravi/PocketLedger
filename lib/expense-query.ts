import type {Prisma} from '@prisma/client';
import {parseDay} from '@/lib/analytics';

export type ExpenseFilters = {
  where: Prisma.ExpenseWhereInput;
  error?: string;
};

/** Shared filter parsing for GET /api/expenses and GET /api/expenses/export. */
export function expenseFilters(params: URLSearchParams): ExpenseFilters {
  const type = params.get('type');
  if (type && !['NEED', 'WANT', 'INCOME'].includes(type)) {
    return {where: {}, error: `type: must be one of NEED, WANT, INCOME`};
  }
  const search = params.get('q')?.trim();
  const categoryId = params.get('categoryId')?.trim();
  const creditCardId = params.get('creditCardId')?.trim();
  const month = params.get('month');
  const from = parseDay(params.get('from'));
  const to = parseDay(params.get('to'));

  const date: {gte?: Date; lt?: Date} = {};
  if (from) date.gte = from;
  if (to) date.lt = new Date(to.getTime() + 86_400_000);
  if (!from && !to && month && /^\d{4}-\d{2}$/.test(month)) {
    const [year, mon] = month.split('-').map(Number);
    if (mon >= 1 && mon <= 12) {
      date.gte = new Date(year, mon - 1, 1);
      date.lt = new Date(year, mon, 1);
    }
  }

  const where: Prisma.ExpenseWhereInput = {
    ...(categoryId ? {categoryId} : {}),
    ...(creditCardId ? {creditCardId} : {}),
    ...(type ? {type: type as 'NEED' | 'WANT' | 'INCOME'} : {}),
    ...(Object.keys(date).length ? {date} : {}),
    ...(search ? {description: {contains: search, mode: 'insensitive'}} : {}),
  };

  return {where};
}
