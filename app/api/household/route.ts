import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {prisma} from '@/lib/prisma';
import {requireUser} from '@/lib/auth';
import {ensureHousehold} from '@/lib/household';
import {validate} from '@/lib/validation';

async function householdDto(userId: string, fullName: string) {
  const household = await ensureHousehold(userId, fullName);
  const full = await prisma.household.findUnique({
    where: {id: household.id},
    include: {
      members: {
        include: {user: {select: {fullName: true, email: true}}},
        orderBy: {joinedAt: 'asc'},
      },
    },
  });
  if (!full) return null;
  const mine = full.members.find((member) => member.userId === userId);
  return {
    id: full.id,
    name: full.name,
    inviteCode: full.inviteCode,
    role: mine?.role ?? 'MEMBER',
    members: full.members.map((member) => ({
      userId: member.userId,
      fullName: member.user.fullName,
      email: member.user.email,
      role: member.role,
      joinedAt: member.joinedAt,
    })),
  };
}

export async function GET() {
  const auth = await requireUser();
  if (auth.error) return auth.error;
  const dto = await householdDto(auth.user.id, auth.user.fullName);
  if (!dto) return NextResponse.json({error: 'household not found'}, {status: 404});
  return NextResponse.json({household: dto});
}

const renameSchema = z.object({name: z.string().trim().min(1, 'Name is required').max(60)});

export async function PATCH(req: NextRequest) {
  const auth = await requireUser();
  if (auth.error) return auth.error;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }
  const parsed = validate(renameSchema, body);
  if ('error' in parsed) return NextResponse.json({error: parsed.error}, {status: 400});

  const dto = await householdDto(auth.user.id, auth.user.fullName);
  if (!dto) return NextResponse.json({error: 'household not found'}, {status: 404});
  await prisma.household.update({where: {id: dto.id}, data: {name: parsed.data.name}});
  const after = await householdDto(auth.user.id, auth.user.fullName);
  return NextResponse.json({household: after});
}
