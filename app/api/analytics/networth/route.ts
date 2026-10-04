import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';
import {computeNetWorth, type CardDueRow, type LoanDueRow} from '@/lib/networth';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const [accounts, cards, grouped, loanRows] = await Promise.all([
    prisma.account.findMany({where: {userId: {in: memberIds}}, orderBy: {createdAt: 'asc'}}),
    prisma.creditCard.findMany({where: {userId: {in: memberIds}}, orderBy: {cardName: 'asc'}}),
    prisma.expense.groupBy({
      by: ['creditCardId'],
      where: {userId: {in: memberIds}, type: {not: 'INCOME'}, creditCardId: {not: null}},
      _sum: {amount: true},
    }),
    prisma.loan.findMany({where: {userId: {in: memberIds}}, include: {installments: true}}),
  ]);

  const duesById = new Map(grouped.map((row) => [row.creditCardId, Number(row._sum.amount ?? 0)]));
  const cardDues: CardDueRow[] = cards.map((card) => ({
    id: card.id,
    cardName: card.cardName,
    dues: duesById.get(card.id) ?? 0,
  }));
  const loans: LoanDueRow[] = loanRows.map((loan) => ({
    id: loan.id,
    lenderName: loan.lenderName,
    outstanding: loan.installments
      .filter((row) => row.status === 'DUE')
      .reduce((sum, row) => sum + Number(row.amount), 0),
  }));

  return NextResponse.json({
    accounts: accounts.map((row) => ({id: row.id, name: row.name, type: row.type, balance: Number(row.balance)})),
    cards: cardDues,
    loans,
    ...computeNetWorth(accounts, cardDues, loans),
  });
}
