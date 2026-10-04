import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {sharedMemberIds} from '@/lib/household';
import {accountSchema, validate} from '@/lib/validation';
import {requireUser} from '@/lib/auth';
import {toAccountDto} from '@/lib/networth';

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const memberIds = await sharedMemberIds(auth.user.id);
  const accounts = await prisma.account.findMany({
    where: {userId: {in: memberIds}},
    orderBy: {createdAt: 'asc'},
  });
  return NextResponse.json({accounts: accounts.map(toAccountDto)});
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
  const parsed = validate(accountSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const {name, type, balance} = parsed.data;
  const account = await prisma.account.create({
    data: {userId: auth.user.id, name, type, balance},
  });
  return NextResponse.json({account: toAccountDto(account)}, {status: 201});
}
