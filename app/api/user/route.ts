import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {userSchema, validate} from '@/lib/validation';
import {clearSessionCookie, requireUser} from '@/lib/auth';

/** Never expose passwordHash / tokenVersion to the client. */
const PUBLIC_USER = {
  id: true,
  email: true,
  fullName: true,
  currencySymbol: true,
  monthlyIncome: true,
  budgetRollover: true,
  createdAt: true,
} as const;

const toDto = (user: {monthlyIncome: unknown}) => ({
  ...user,
  monthlyIncome: Number(user.monthlyIncome),
});

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const user = await prisma.user.findUnique({where: {id: auth.user.id}, select: PUBLIC_USER});
  if (!user) return NextResponse.json({error: 'profile not found'}, {status: 404});
  return NextResponse.json({user: toDto(user)});
}

export async function PUT(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(userSchema.partial(), body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const existing = await prisma.user.findUnique({where: {id: auth.user.id}});
  if (!existing) return NextResponse.json({error: 'profile not found'}, {status: 404});

  const user = await prisma.user.update({
    where: {id: auth.user.id},
    data: parsed.data,
    select: PUBLIC_USER,
  });
  return NextResponse.json({user: toDto(user)});
}

/** Deletes the signed-in account and everything it owns (DB cascades). */
export async function DELETE() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  await prisma.user.delete({where: {id: auth.user.id}});
  // a solo household evaporates with its last member
  await prisma.household.deleteMany({where: {members: {none: {}}}});
  await clearSessionCookie();
  return NextResponse.json({ok: true});
}
