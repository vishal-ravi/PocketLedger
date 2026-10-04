import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {expenseFilters} from '@/lib/expense-query';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const escape = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);

  const {where, error} = expenseFilters(req.nextUrl.searchParams);
  if (error) return NextResponse.json({error}, {status: 400});

  const expenses = await prisma.expense.findMany({
    where: {userId: {in: memberIds}, ...where},
    include: {category: true, creditCard: true},
    orderBy: {date: 'desc'},
    take: 10000,
  });

  const header = [
    'Date',
    'Description',
    'Category',
    'Class',
    'Payment Method',
    'Card',
    'Amount',
    'My Share',
    'Split',
    'Notes',
  ];
  const lines = [header.join(',')];
  for (const row of expenses) {
    lines.push(
      [
        escape(new Date(row.date).toISOString().slice(0, 10)),
        escape(row.description),
        escape(row.category?.name ?? ''),
        escape(row.type),
        escape(row.paymentMethod),
        escape(row.creditCard?.cardName ?? ''),
        escape(Number(row.amount).toFixed(2)),
        escape(Number(row.myShare).toFixed(2)),
        escape(row.isSplit ? 'yes' : 'no'),
        escape(row.notes ?? ''),
      ].join(','),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pocketledger-expenses-${stamp}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
