import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {loanSchema, validate} from '@/lib/validation';
import {buildSchedule, computeEmi, toLoanDto} from '@/lib/loans';
import {round2} from '@/lib/analytics';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const loans = await prisma.loan.findMany({
    where: {userId: {in: memberIds}},
    include: {installments: true},
    orderBy: {createdAt: 'asc'},
  });
  return NextResponse.json({loans: loans.map((loan) => toLoanDto(loan))});
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
  const parsed = validate(loanSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const {lenderName, principal, annualRate, tenureMonths, emiAmount, startDate, categoryId, paymentMethod, creditCardId, notes} =
    parsed.data;

  const memberIds = await sharedMemberIds(auth.user.id);

  if (categoryId) {
    const category = await prisma.category.findFirst({where: {id: categoryId, userId: {in: memberIds}}});
    if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  }
  if (creditCardId) {
    const card = await prisma.creditCard.findFirst({where: {id: creditCardId, userId: {in: memberIds}}});
    if (!card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  }

  const emi = round2(emiAmount ?? computeEmi(principal, annualRate, tenureMonths));
  if (emi <= 0) return NextResponse.json({error: 'emiAmount: could not compute an EMI'}, {status: 400});

  const schedule = buildSchedule(startDate, tenureMonths, emi);
  const loan = await prisma.$transaction(async (tx) => {
    const created = await tx.loan.create({
      data: {
        userId: auth.user.id,
        lenderName,
        principal,
        annualRate,
        tenureMonths,
        emiAmount: emi,
        startDate,
        categoryId: categoryId ?? null,
        paymentMethod,
        creditCardId: paymentMethod === 'CREDIT_CARD' ? (creditCardId ?? null) : null,
        notes: notes ?? null,
      },
    });
    await tx.loanInstallment.createMany({
      data: schedule.map((row) => ({loanId: created.id, ...row})),
    });
    return created;
  });

  const withInstallments = await prisma.loan.findUnique({
    where: {id: loan.id},
    include: {installments: true},
  });
  return NextResponse.json({loan: toLoanDto(withInstallments!)}, {status: 201});
}
