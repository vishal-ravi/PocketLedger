import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {summarize} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const expenses = await prisma.expense.findMany({
    where: {userId: {in: memberIds}, date: {gte: start}},
    include: {category: true},
  });
  const summary = summarize(
    expenses.map((row) => ({type: row.type, amount: Number(row.amount), category: row.category?.name ?? 'Income'})),
    Math.max(1, now.getDate()),
  );
  return NextResponse.json({summary});
}
