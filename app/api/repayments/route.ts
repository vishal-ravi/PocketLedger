import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {repaymentSchema, validate} from '@/lib/validation';
import {ensureCategory, pendingSplits, splitTotals} from '@/lib/debts';
import {round2} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const [rows, history] = await Promise.all([
    pendingSplits(memberIds),
    prisma.debtRepayment.findMany({
      where: {userId: {in: memberIds}},
      orderBy: {date: 'desc'},
      take: 50,
    }),
  ]);
  const totals = splitTotals(rows);
  return NextResponse.json({
    receivable: totals.receivable,
    payable: totals.payable,
    people: totals.people,
    history: history.map((row) => ({
      id: row.id,
      personName: row.personName,
      direction: row.direction,
      amount: Number(row.amount),
      date: row.date.toISOString().slice(0, 10),
      note: row.note,
      expenseId: row.expenseId,
    })),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(repaymentSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const {personName, direction, amount, date, note} = parsed.data;
  const memberIds = await sharedMemberIds(auth.user.id);
  const rows = await pendingSplits(memberIds);
  const open = rows.filter((row) => row.personName === personName);

  const outstanding = round2(
    open.reduce((sum, row) => sum + (direction === 'I_OWE' ? Number(row.amountIOwe) : Number(row.amountOwedToMe)), 0),
  );
  if (outstanding <= 0) {
    return NextResponse.json({error: `no open ${direction === 'I_OWE' ? 'payable' : 'receivable'} for ${personName}`}, {status: 400});
  }
  if (amount > outstanding + 0.001) {
    return NextResponse.json({error: `amount: exceeds open balance of ${outstanding}`}, {status: 400});
  }

  const now = new Date();
  const paidOn = date ?? new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const result = await prisma.$transaction(async (tx) => {
    let expenseId: string | null = null;
    // Apply the repayment oldest-first across this person's open split rows.
    let left = amount;
    for (const row of open) {
      if (left <= 0) break;
      const current = round2(direction === 'I_OWE' ? Number(row.amountIOwe) : Number(row.amountOwedToMe));
      if (current <= 0) continue;
      const applied = round2(Math.min(current, left));
      left = round2(left - applied);
      const nextIOwe = direction === 'I_OWE' ? round2(current - applied) : Number(row.amountIOwe);
      const nextOwed = direction === 'OWED_TO_ME' ? round2(current - applied) : Number(row.amountOwedToMe);
      await tx.splitDetail.update({
        where: {id: row.id},
        data: {
          amountIOwe: nextIOwe,
          amountOwedToMe: nextOwed,
          status: nextIOwe === 0 && nextOwed === 0 ? 'SETTLED' : 'PENDING',
          repaymentDate: nextIOwe === 0 && nextOwed === 0 ? paidOn : null,
        },
      });
    }

    // Paying someone back is real cash out, so it lands in the ledger as a NEED.
    if (direction === 'I_OWE') {
      const category = await ensureCategory(tx, auth.user.id, memberIds, 'Debt Repayments', '#e11d48');
      const expense = await tx.expense.create({
        data: {
          userId: auth.user.id,
          date: paidOn,
          categoryId: category.id,
          description: `Repayment to ${personName}`,
          paymentMethod: 'UPI',
          amount,
          type: 'NEED',
          notes: note ?? 'Split debt settlement',
        },
      });
      expenseId = expense.id;
    }

    const record = await tx.debtRepayment.create({
      data: {
        userId: auth.user.id,
        personName,
        direction,
        amount,
        date: paidOn,
        note: note ?? null,
        expenseId,
      },
    });
    return {record, expenseId};
  });

  const fresh = splitTotals(await pendingSplits(memberIds));
  return NextResponse.json(
    {
      repayment: {
        id: result.record.id,
        personName,
        direction,
        amount,
        date: paidOn.toISOString().slice(0, 10),
        expenseId: result.expenseId,
      },
      receivable: fresh.receivable,
      payable: fresh.payable,
      people: fresh.people,
    },
    {status: 201},
  );
}
