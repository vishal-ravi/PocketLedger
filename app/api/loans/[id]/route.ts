import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {loanPatchSchema, validate} from '@/lib/validation';
import {toLoanDto} from '@/lib/loans';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};

async function findLoan(id: string, memberIds: string[]) {
  return prisma.loan.findFirst({
    where: {id, userId: {in: memberIds}},
    include: {installments: {orderBy: {number: 'asc'}}},
  });
}

export async function GET(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const loan = await findLoan(id, memberIds);
  if (!loan) return NextResponse.json({error: 'loan not found'}, {status: 404});
  return NextResponse.json({
    loan: toLoanDto(loan),
    installments: loan.installments.map((row) => ({
      id: row.id,
      number: row.number,
      dueDate: row.dueDate.toISOString().slice(0, 10),
      amount: Number(row.amount),
      status: row.status,
      paidDate: row.paidDate ? row.paidDate.toISOString().slice(0, 10) : null,
      expenseId: row.expenseId,
    })),
  });
}

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await findLoan(id, memberIds);
  if (!existing) return NextResponse.json({error: 'loan not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(loanPatchSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  if (parsed.data.categoryId) {
    const category = await prisma.category.findFirst({
      where: {id: parsed.data.categoryId, userId: {in: memberIds}},
    });
    if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  }
  if (parsed.data.creditCardId) {
    const card = await prisma.creditCard.findFirst({
      where: {id: parsed.data.creditCardId, userId: {in: memberIds}},
    });
    if (!card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  }

  const data = {...parsed.data};
  if (data.paymentMethod && data.paymentMethod !== 'CREDIT_CARD') data.creditCardId = null;

  const loan = await prisma.loan.update({where: {id}, data, include: {installments: true}});
  return NextResponse.json({loan: toLoanDto(loan)});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await findLoan(id, memberIds);
  if (!existing) return NextResponse.json({error: 'loan not found'}, {status: 404});
  await prisma.loan.delete({where: {id}});
  return NextResponse.json({ok: true});
}
