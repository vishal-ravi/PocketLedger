import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {categorySchema, validate} from '@/lib/validation';
import {requireUser} from '@/lib/auth';
import {sharedMemberIds} from '@/lib/household';

type Params = {params: Promise<{id: string}>};

async function own(id: string, memberIds: string[]) {
  return prisma.category.findFirst({where: {id, userId: {in: memberIds}}});
}

export async function PATCH(req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  if (!(await own(id, memberIds))) return NextResponse.json({error: 'category not found'}, {status: 404});

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(categorySchema.partial(), body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const category = await prisma.category.update({where: {id}, data: parsed.data});
  return NextResponse.json({category});
}

export async function DELETE(_req: NextRequest, {params}: Params) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  const {id} = await params;
  const memberIds = await sharedMemberIds(auth.user.id);
  const category = await own(id, memberIds);
  if (!category) return NextResponse.json({error: 'category not found'}, {status: 404});

  const used = await prisma.expense.count({where: {categoryId: id}});
  if (used > 0) {
    return NextResponse.json({error: `category is used by ${used} transaction(s) and cannot be deleted`}, {status: 409});
  }
  await prisma.category.delete({where: {id}});
  return NextResponse.json({ok: true});
}
