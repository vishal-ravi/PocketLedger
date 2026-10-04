import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {sharedMemberIds} from '@/lib/household';
import {creditCardSchema, validate} from '@/lib/validation';
import {requireUser} from '@/lib/auth';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const cards = await prisma.creditCard.findMany({
    where: {userId: {in: memberIds}},
    include: {expenses: {where: {type: {not: 'INCOME'}}, select: {amount: true}}},
  });
  return NextResponse.json({
    cards: cards.map((c) => {
      const spent = c.expenses.reduce((s, e) => s + Number(e.amount), 0);
      return {...c, spent, available: Number(c.creditLimit) - spent, expenses: undefined};
    }),
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
  const parsed = validate(creditCardSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const card = await prisma.creditCard.create({data: {userId: auth.user.id, ...parsed.data}});
  return NextResponse.json({card}, {status: 201});
}
