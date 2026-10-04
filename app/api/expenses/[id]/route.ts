import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {expensePatchSchema, validate} from '@/lib/validation';
import {fxIssue} from '@/lib/fx';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};

export async function GET(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const expense = await prisma.expense.findFirst({
    where: {id, userId: {in: memberIds}},
    include: {category: true, creditCard: true, splitDetails: true},
  });
  if (!expense) return NextResponse.json({error: 'expense not found'}, {status: 404});
  return NextResponse.json({expense});
}

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.expense.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'expense not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(expensePatchSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});
  const input = parsed.data;

  if (input.categoryId) {
    const category = await prisma.category.findFirst({where: {id: input.categoryId, userId: {in: memberIds}}});
    if (!category) return NextResponse.json({error: 'categoryId: unknown category'}, {status: 400});
  }
  if (input.creditCardId) {
    const card = await prisma.creditCard.findFirst({where: {id: input.creditCardId, userId: {in: memberIds}}});
    if (!card) return NextResponse.json({error: 'creditCardId: unknown card'}, {status: 400});
  }
  // Flipping an entry to non-income needs a category (patch value, else the one it already has).
  const nextType = input.type ?? existing.type;
  if (nextType !== 'INCOME' && !input.categoryId && !existing.categoryId) {
    return NextResponse.json({error: 'categoryId: required unless type is INCOME'}, {status: 400});
  }

  const mergedFx = {
    originalCurrency: input.originalCurrency !== undefined ? input.originalCurrency : existing.originalCurrency,
    originalAmount: input.originalAmount !== undefined ? input.originalAmount : existing.originalAmount,
    fxRate: input.fxRate !== undefined ? input.fxRate : existing.fxRate,
  };
  const fxError = fxIssue({
    originalCurrency: mergedFx.originalCurrency,
    originalAmount: mergedFx.originalAmount === null ? null : Number(mergedFx.originalAmount),
    fxRate: mergedFx.fxRate === null ? null : Number(mergedFx.fxRate),
  });
  if (fxError) return NextResponse.json({error: `originalCurrency: ${fxError}`}, {status: 400});

  const derivedIsSplit = input.splits !== undefined ? input.splits.length > 0 : input.isSplit;

  const expense = await prisma.$transaction(async (tx) => {
    await tx.expense.update({
      where: {id},
      data: {
        ...(input.date ? {date: input.date} : {}),
        ...(input.description ? {description: input.description} : {}),
        ...(input.categoryId !== undefined ? {categoryId: input.categoryId} : {}),
        ...(input.paymentMethod ? {paymentMethod: input.paymentMethod} : {}),
        ...(input.amount !== undefined ? {amount: input.amount} : {}),
        ...(input.type ? {type: input.type} : {}),
        ...(input.notes !== undefined ? {notes: input.notes} : {}),
        ...(input.creditCardId !== undefined ? {creditCardId: input.creditCardId} : {}),
        ...(input.whoPaid ? {whoPaid: input.whoPaid} : {}),
        ...(input.myShare !== undefined ? {myShare: input.myShare} : {}),
        ...(derivedIsSplit !== undefined ? {isSplit: Boolean(derivedIsSplit)} : {}),
        ...(input.originalCurrency !== undefined ? {originalCurrency: input.originalCurrency} : {}),
        ...(input.originalAmount !== undefined ? {originalAmount: input.originalAmount} : {}),
        ...(input.fxRate !== undefined ? {fxRate: input.fxRate} : {}),
      },
    });

    if (input.splits !== undefined || input.isSplit === false) {
      await tx.splitDetail.deleteMany({where: {expenseId: id}});
      if (input.splits?.length) {
        await tx.splitDetail.createMany({
          data: input.splits.map((split) => ({
            expenseId: id,
            personName: split.personName,
            amountOwedToMe: split.amountOwedToMe,
            amountIOwe: split.amountIOwe,
            owedToPerson: split.owedToPerson ?? null,
          })),
        });
      }
    }

    return tx.expense.findUnique({where: {id}, include: {category: true, creditCard: true, splitDetails: true}});
  });

  return NextResponse.json({expense});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.expense.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'expense not found'}, {status: 404});
  await prisma.expense.delete({where: {id}});
  return NextResponse.json({ok: true});
}
