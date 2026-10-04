import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {accountSchema, validate} from '@/lib/validation';
import {requireUser} from '@/lib/auth';
import {toAccountDto} from '@/lib/networth';

type Params = {params: Promise<{id: string}>};

async function own(id: string, userId: string) {
  return prisma.account.findFirst({where: {id, userId}});
}

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  if (!(await own(id, auth.user.id))) return NextResponse.json({error: 'account not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(accountSchema.partial(), body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const account = await prisma.account.update({where: {id}, data: parsed.data});
  return NextResponse.json({account: toAccountDto(account)});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  if (!(await own(id, auth.user.id))) return NextResponse.json({error: 'account not found'}, {status: 404});

  await prisma.account.delete({where: {id}});
  return NextResponse.json({ok: true});
}
