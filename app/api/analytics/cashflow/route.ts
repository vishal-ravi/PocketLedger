import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const now = new Date();
  const months = Array.from({length: 6}, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return {
      key: `${date.getFullYear()}-${date.getMonth()}`,
      month: date.toLocaleString('en-IN', {month: 'short'}),
      income: 0,
      expenses: 0,
    };
  });

  const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const rows = await prisma.expense.findMany({where: {userId: {in: memberIds}, date: {gte: start}}});
  for (const row of rows) {
    const slot = months.find((m) => m.key === `${row.date.getFullYear()}-${row.date.getMonth()}`);
    if (!slot) continue;
    if (row.type === 'INCOME') slot.income += Number(row.amount);
    else slot.expenses += Number(row.amount);
  }

  return NextResponse.json({
    months: months.map((m) => ({month: m.month, income: m.income, expenses: m.expenses, savings: m.income - m.expenses})),
  });
}
