import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {emiPaySchema, validate} from '@/lib/validation';
import {toLoanDto} from '@/lib/loans';
import {ensureCategory} from '@/lib/debts';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};

export async function POST(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const loan = await prisma.loan.findFirst({
    where: {id, userId: {in: memberIds}},
    include: {installments: true},
  });
  if (!loan) return NextResponse.json({error: 'loan not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(emiPaySchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const installment = loan.installments.find((row) => row.id === parsed.data.installmentId);
  if (!installment) return NextResponse.json({error: 'installment not found'}, {status: 404});
  if (installment.status === 'PAID') {
    return NextResponse.json({error: 'installment already paid'}, {status: 409});
  }

  const now = new Date();
  const date = parsed.data.date ?? new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const paymentMethod = parsed.data.paymentMethod ?? loan.paymentMethod;
  let creditCardId: string | null =
    parsed.data.creditCardId ?? (paymentMethod === 'CREDIT_CARD' ? loan.creditCardId : null);
  if (paymentMethod !== 'CREDIT_CARD') creditCardId = null;
  if (creditCardId) {
    const card = await prisma.creditCard.findFirst({where: {id: creditCardId, userId: {in: memberIds}}});
    if (!card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  }
  const category = loan.categoryId
    ? await prisma.category.findFirst({where: {id: loan.categoryId, userId: {in: memberIds}}})
    : await ensureCategory(prisma, auth.user.id, memberIds, 'Loan EMIs', '#e11d48');
  if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});

  const expense = await prisma.$transaction(async (tx) => {
    const created = await tx.expense.create({
      data: {
        userId: auth.user.id,
        date,
        categoryId: category.id,
        description: `EMI ${installment.number} · ${loan.lenderName}`,
        paymentMethod,
        creditCardId,
        amount: Number(installment.amount),
        type: 'NEED',
        notes: `Instalment ${installment.number} of ${loan.tenureMonths}`,
      },
    });
    await tx.loanInstallment.update({
      where: {id: installment.id},
      data: {status: 'PAID', paidDate: date, expenseId: created.id},
    });
    return created;
  });

  const fresh = await prisma.loan.findFirst({
    where: {id: loan.id, userId: {in: memberIds}},
    include: {installments: {orderBy: {number: 'asc'}}},
  });

  return NextResponse.json({
    expenseId: expense.id,
    installment: {id: installment.id, number: installment.number, amount: Number(installment.amount)},
    loan: toLoanDto(fresh!),
  });
}
