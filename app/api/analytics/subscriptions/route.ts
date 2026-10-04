import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {DAY_MS, detectSubscriptions} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const round = (value: number) => Math.round(value * 100) / 100;
const isoDay = (date: Date) => {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const since = new Date(Date.now() - 190 * DAY_MS);
  const [rows, categories] = await Promise.all([
    prisma.expense.findMany({
      where: {userId: {in: memberIds}, type: {not: 'INCOME'}, date: {gte: since}},
      select: {date: true, amount: true, description: true, categoryId: true},
      orderBy: {date: 'asc'},
    }),
    prisma.category.findMany({where: {userId: {in: memberIds}}, select: {id: true, name: true, colorCode: true}}),
  ]);

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const recurring = rows.map((row) => ({
    date: row.date,
    amount: Number(row.amount),
    description: row.description,
    categoryId: row.categoryId ?? '',
  }));
  const subscriptions = detectSubscriptions(recurring, new Date()).slice(0, 12);

  return NextResponse.json({
    subscriptions: subscriptions.map((row) => {
      const category = categoryById.get(row.categoryId);
      return {
        name: row.name,
        amount: round(row.amount),
        occurrences: row.occurrences,
        lastDate: isoDay(row.lastDate),
        nextDue: isoDay(row.nextDue),
        gapDays: row.gapDays,
        overdue: row.nextDue.getTime() < Date.now(),
        category: category?.name ?? 'Uncategorised',
        color: category?.colorCode ?? '#6366f1',
      };
    }),
    commitment: round(subscriptions.reduce((sum, row) => sum + row.amount, 0)),
    scanned: recurring.length,
    windowDays: 190,
  });
}
