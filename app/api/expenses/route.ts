import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {expenseSchema, validate} from '@/lib/validation';
import {expenseFilters} from '@/lib/expense-query';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const {where, error} = expenseFilters(req.nextUrl.searchParams);
  if (error) return NextResponse.json({error}, {status: 400});

  const params = req.nextUrl.searchParams;
  const limitRaw = params.get('limit');
  const offsetRaw = params.get('offset');
  const limit = Math.min(MAX_LIMIT, Math.max(1, limitRaw ? Number(limitRaw) || DEFAULT_LIMIT : DEFAULT_LIMIT));
  const offset = Math.max(0, offsetRaw ? Number(offsetRaw) || 0 : 0);

  const scoped = {userId: {in: memberIds}, ...where};
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where: scoped,
      include: {category: true, creditCard: true, splitDetails: true},
      orderBy: [{date: 'desc'}, {createdAt: 'desc'}],
      skip: offset,
      take: limit,
    }),
    prisma.expense.count({where: scoped}),
  ]);
  return NextResponse.json({
    expenses,
    total,
    limit,
    offset,
    hasMore: offset + expenses.length < total,
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
  const parsed = validate(expenseSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const input = parsed.data;
  const memberIds = await sharedMemberIds(auth.user.id);
  const card = await prisma.creditCard.findFirst({where: {id: input.creditCardId ?? '', userId: {in: memberIds}}});
  if (input.creditCardId && !card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  if (input.categoryId) {
    const category = await prisma.category.findFirst({where: {id: input.categoryId, userId: {in: memberIds}}});
    if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  }

  const expense = await prisma.expense.create({
    data: {
      userId: auth.user.id,
      date: input.date,
      categoryId: input.categoryId ?? null,
      description: input.description,
      paymentMethod: input.paymentMethod,
      amount: input.amount,
      type: input.type,
      notes: input.notes ?? null,
      isSplit: Boolean(input.isSplit),
      whoPaid: input.whoPaid ?? 'Me',
      myShare: input.myShare ?? input.amount,
      creditCardId: input.creditCardId ?? null,
      originalAmount: input.originalAmount ?? null,
      originalCurrency: input.originalCurrency ?? null,
      fxRate: input.fxRate ?? null,
      splitDetails: input.splits?.length
        ? {
            create: input.splits.map((split) => ({
              personName: split.personName,
              amountOwedToMe: split.amountOwedToMe,
              amountIOwe: split.amountIOwe,
              owedToPerson: split.owedToPerson ?? null,
            })),
          }
        : undefined,
    },
    include: {category: true, splitDetails: true},
  });
  return NextResponse.json({expense}, {status: 201});
}
