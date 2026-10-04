import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {sharedMemberIds} from '@/lib/household';
import {creditCardSchema, validate} from '@/lib/validation';
import {requireUser} from '@/lib/auth';

type Params = {params: Promise<{id: string}>};

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.creditCard.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'card not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(creditCardSchema.partial(), body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const card = await prisma.creditCard.update({where: {id}, data: parsed.data});
  return NextResponse.json({card});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const existing = await prisma.creditCard.findFirst({where: {id, userId: {in: memberIds}}});
  if (!existing) return NextResponse.json({error: 'card not found'}, {status: 404});
  await prisma.creditCard.delete({where: {id}});
  return NextResponse.json({ok: true});
}
