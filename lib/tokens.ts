import {createHash, randomBytes} from 'node:crypto';
import {prisma} from '@/lib/prisma';

export type AuthTokenType = 'RESET_PASSWORD';

/** Single-use tokens for password reset. Only the SHA-256 hash is stored. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createAuthToken(
  email: string,
  type: AuthTokenType,
  ttlMinutes: number,
  userId?: string,
): Promise<{token: string; expiresAt: Date}> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);

  // Only the newest token per (email, type) stays valid.
  await prisma.authToken.deleteMany({where: {email, type, usedAt: null}});
  await prisma.authToken.create({
    data: {
      userId: userId ?? null,
      email,
      type,
      tokenHash: hashToken(token),
      expiresAt,
    },
  });
  return {token, expiresAt};
}

/** Validate + consume a token. Returns the linked account or null if invalid/expired/used. */
export async function consumeAuthToken(
  rawToken: string,
  type: AuthTokenType,
): Promise<{userId: string | null; email: string} | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const record = await prisma.authToken.findFirst({where: {tokenHash: hashToken(rawToken), type}});
  if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) return null;
  await prisma.authToken.update({where: {id: record.id}, data: {usedAt: new Date()}});
  // Burn any other outstanding tokens of this type for the same account.
  await prisma.authToken.deleteMany({
    where: {email: record.email, type, usedAt: null},
  });
  return {userId: record.userId, email: record.email};
}
