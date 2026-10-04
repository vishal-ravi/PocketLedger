import {randomBytes} from 'node:crypto';
import {prisma} from '@/lib/prisma';

/** Ambiguous characters (0/O, 1/I/L) are left out so invite codes are easy to read aloud. */
const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

export function normalizeInviteCode(input: string | null | undefined): string {
  return (input ?? '').replace(/[^0-9a-z]/gi, '').toUpperCase();
}

export type MemberRow = {userId: string; role: string; joinedAt: Date};

/** When the owner leaves, the longest-standing member takes over. */
export function pickNewOwner(members: MemberRow[]): {userId: string} | null {
  const candidates = members
    .filter((member) => member.role !== 'OWNER')
    .sort((a, b) => a.joinedAt.getTime() - b.joinedAt.getTime());
  return candidates.length > 0 ? {userId: candidates[0].userId} : null;
}

export function householdNameFor(fullName: string | null | undefined): string {
  const first = (fullName ?? '').trim().split(/\s+/)[0];
  return first ? `${first}'s household` : 'Our household';
}

async function uniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateInviteCode();
    const taken = await prisma.household.findUnique({where: {inviteCode: code}, select: {id: true}});
    if (!taken) return code;
  }
  throw new Error('could not allocate a unique invite code');
}

/** Every user belongs to exactly one household; created lazily on first use. */
export async function ensureHousehold(userId: string, fullName: string) {
  const existing = await prisma.householdMember.findFirst({
    where: {userId},
    include: {household: true},
  });
  if (existing) return existing.household;
  const household = await prisma.household.create({
    data: {name: householdNameFor(fullName), inviteCode: await uniqueInviteCode()},
  });
  await prisma.householdMember.create({
    data: {householdId: household.id, userId, role: 'OWNER'},
  });
  return household;
}

/**
 * Ids whose data this user may read and edit: themselves plus everyone in their
 * household. Users without a household keep the old single-user scope.
 */
export async function sharedMemberIds(userId: string): Promise<string[]> {
  const memberships = await prisma.householdMember.findMany({
    where: {userId},
    select: {householdId: true},
  });
  if (memberships.length === 0) return [userId];
  const rows = await prisma.householdMember.findMany({
    where: {householdId: {in: memberships.map((m) => m.householdId)}},
    select: {userId: true},
  });
  return [...new Set(rows.map((row) => row.userId))];
}

export type MemberAccount = {id: string; email: string};

/** Emails of every account in scope — used for per-member recurring reminders. */
export async function memberAccounts(memberIds: string[]): Promise<MemberAccount[]> {
  return prisma.user.findMany({where: {id: {in: memberIds}}, select: {id: true, email: true}});
}
