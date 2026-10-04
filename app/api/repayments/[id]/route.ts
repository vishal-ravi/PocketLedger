import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {splitTotals} from '@/lib/debts';
import {round2} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};

/**
 * Undoes a repayment: the amount goes back on the person's split rows and the
 * ledger expense created for it is removed.
 */
export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const record = await prisma.debtRepayment.findFirst({where: {id, userId: {in: memberIds}}});
  if (!record) return NextResponse.json({error: 'repayment not found'}, {status: 404});

  const rows = await prisma.splitDetail.findMany({
    where: {personName: record.personName, expense: {userId: {in: memberIds}}},
    orderBy: {expense: {date: 'asc'}},
  });
  const direction = record.direction;
  const eligible = rows.filter((row) =>
    direction === 'I_OWE'
      ? Number(row.amountOwedToMe) === 0 || Number(row.amountIOwe) > 0
      : Number(row.amountIOwe) === 0 || Number(row.amountOwedToMe) > 0,
  );
  const target = eligible[0];

  await prisma.$transaction(async (tx) => {
    if (target) {
      const current = direction === 'I_OWE' ? Number(target.amountIOwe) : Number(target.amountOwedToMe);
      const restored = round2(current + Number(record.amount));
      await tx.splitDetail.update({
        where: {id: target.id},
        data:
          direction === 'I_OWE'
            ? {amountIOwe: restored, status: 'PENDING', repaymentDate: null}
            : {amountOwedToMe: restored, status: 'PENDING', repaymentDate: null},
      });
    }
    if (record.expenseId) await tx.expense.deleteMany({where: {id: record.expenseId, userId: {in: memberIds}}});
    await tx.debtRepayment.delete({where: {id: record.id}});
  });

  const totals = splitTotals(
    await prisma.splitDetail.findMany({
      where: {status: 'PENDING', expense: {userId: {in: memberIds}}},
      include: {expense: {select: {date: true}}},
      orderBy: {expense: {date: 'asc'}},
    }),
  );
  return NextResponse.json({ok: true, receivable: totals.receivable, payable: totals.payable, people: totals.people});
}
