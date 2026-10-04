import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {isoDay} from '@/lib/analytics';
import {isMonth, monthLabel, parseMonth, summarise} from '@/lib/statements';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const MAX_ROWS = 500;

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const params = req.nextUrl.searchParams;
  const month = params.get('month');
  if (!isMonth(month)) return NextResponse.json({error: 'month: expected YYYY-MM'}, {status: 400});

  const cardId = params.get('cardId');
  const range = parseMonth(month)!;

  let card: {id: string; cardName: string; statementGenerationDay: number; dueDay: number} | null = null;
  if (cardId) {
    const found = await prisma.creditCard.findFirst({
      where: {id: cardId, userId: {in: memberIds}},
      select: {id: true, cardName: true, statementGenerationDay: true, dueDay: true},
    });
    if (!found) return NextResponse.json({error: 'cardId: unknown card'}, {status: 400});
    card = found;
  }

  const expenses = await prisma.expense.findMany({
    where: {
      userId: {in: memberIds},
      date: {gte: range.from, lt: range.to},
      ...(cardId ? {creditCardId: cardId} : {}),
    },
    include: {category: {select: {name: true, colorCode: true}}},
    orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
  });

  const rows = expenses.map((row) => ({
    date: row.date,
    amount: Number(row.amount),
    type: row.type,
    categoryName: row.category?.name ?? null,
  }));
  const summary = summarise(rows);

  return NextResponse.json({
    month,
    label: monthLabel(month),
    range: {from: isoDay(range.from), to: isoDay(new Date(range.to.getTime() - 1))},
    scope: card ? 'card' : 'all',
    card,
    ...summary,
    transactions: expenses.slice(0, MAX_ROWS).map((row) => ({
      id: row.id,
      date: isoDay(row.date),
      description: row.description,
      category: row.category?.name ?? null,
      color: row.category?.colorCode ?? null,
      amount: Number(row.amount),
      type: row.type,
      paymentMethod: row.paymentMethod,
    })),
    truncated: expenses.length > MAX_ROWS,
  });
}
