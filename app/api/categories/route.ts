import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {categorySchema, validate} from '@/lib/validation';
import {DAY_MS, daysInMonth, projectMonth, round2, startOfDay} from '@/lib/analytics';
import {rolloverAmount} from '@/lib/networth';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const trailStart = new Date(startOfDay(now).getTime() - 30 * DAY_MS);
  const dim = daysInMonth(now.getFullYear(), now.getMonth());
  const elapsed = Math.max(1, now.getDate());
  const user = await prisma.user.findUnique({where: {id: auth.user.id}, select: {budgetRollover: true}});
  const memberIds = await sharedMemberIds(auth.user.id);
  const prevSpend = user?.budgetRollover
    ? await prisma.expense.groupBy({
        by: ['categoryId'],
        where: {userId: {in: memberIds}, type: {not: 'INCOME'}, date: {gte: prevStart, lt: start}},
        _sum: {amount: true},
      })
    : [];
  const prevById = new Map(prevSpend.map((row) => [row.categoryId, Number(row._sum.amount ?? 0)]));
  const cats = await prisma.category.findMany({
    where: {userId: {in: memberIds}},
    include: {expenses: {where: {type: {not: 'INCOME'}, date: {gte: trailStart}}, select: {amount: true, date: true}}},
    orderBy: {name: 'asc'},
  });
  return NextResponse.json({
    categories: cats.map((c) => {
      const spent = c.expenses.filter((e) => e.date >= start).reduce((s, e) => s + Number(e.amount), 0);
      const trailing30 = c.expenses.reduce((s, e) => s + Number(e.amount), 0);
      const budget = Number(c.monthlyBudget);
      const rollover = user?.budgetRollover ? rolloverAmount(budget, prevById.get(c.id) ?? 0) : 0;
      return {
        ...c,
        spent,
        projected: projectMonth(trailing30, spent, elapsed, dim),
        rollover,
        available: round2(budget + rollover),
        expenses: undefined,
      };
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
  const parsed = validate(categorySchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const {name, monthlyBudget, colorCode, taxDeductible} = parsed.data;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.category.findFirst({where: {userId: {in: memberIds}, name}});
  if (existing) {
    return NextResponse.json({error: `A category named "${name}" already exists`}, {status: 409});
  }
  const category = await prisma.category.create({
    data: {userId: auth.user.id, name, monthlyBudget, colorCode, taxDeductible},
  });
  return NextResponse.json({category}, {status: 201});
}
