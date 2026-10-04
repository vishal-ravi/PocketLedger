import {SignJWT, jwtVerify} from 'jose';
import {cookies} from 'next/headers';
import {NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';

export const SESSION_COOKIE = 'pl_session';
export const SESSION_DAYS = 30;

export type SessionUser = {
  id: string;
  email: string;
  fullName: string;
  currencySymbol: string;
  monthlyIncome: number;
};

export type AuthResult = {user: SessionUser; error: null} | {user: null; error: NextResponse};

type SessionClaims = {id: string; tv: number};

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not set — add it to .env');
  return new TextEncoder().encode(secret);
}

/** Secure cookies by default in production; COOKIE_SECURE=0 opts out for local prod testing. */
function secureCookieEnabled(): boolean {
  if (process.env.COOKIE_SECURE === '1') return true;
  if (process.env.COOKIE_SECURE === '0') return false;
  return process.env.NODE_ENV === 'production';
}

export async function createSessionToken(userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({sub: userId, tv: tokenVersion})
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const {payload} = await jwtVerify(token, secretKey());
    if (payload.purpose !== undefined) return null; // a 2FA challenge is never a session
    if (typeof payload.sub !== 'string') return null;
    const tv = typeof payload.tv === 'number' ? payload.tv : 0;
    return {id: payload.sub, tv};
  } catch {
    return null;
  }
}

/** Short-lived token proving the password step succeeded; exchanged for a session after the TOTP code. */
export async function createTwoFactorChallenge(userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({sub: userId, tv: tokenVersion, purpose: '2fa'})
    .setProtectedHeader({alg: 'HS256'})
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(secretKey());
}

export async function verifyTwoFactorChallenge(token: string | undefined | null): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const {payload} = await jwtVerify(token, secretKey());
    if (payload.purpose !== '2fa' || typeof payload.sub !== 'string') return null;
    const tv = typeof payload.tv === 'number' ? payload.tv : 0;
    return {id: payload.sub, tv};
  } catch {
    return null;
  }
}

export async function setSessionCookie(userId: string, tokenVersion: number): Promise<void> {
  const token = await createSessionToken(userId, tokenVersion);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieEnabled(),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Invalidate every outstanding session for a user (password reset, "log out everywhere"). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await prisma.user.update({where: {id: userId}, data: {tokenVersion: {increment: 1}}});
}

export async function getSessionClaims(): Promise<SessionClaims | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const claims = await getSessionClaims();
  if (!claims) return null;
  const user = await prisma.user.findUnique({where: {id: claims.id}});
  // tokenVersion mismatch = the session was revoked (password reset / logout-everywhere).
  if (!user || user.tokenVersion !== claims.tv) return null;
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    currencySymbol: user.currencySymbol,
    monthlyIncome: Number(user.monthlyIncome),
  };
}

/** Guard for API routes: `const auth = await requireUser(); if (auth.error) return auth.error;` */
export async function requireUser(): Promise<AuthResult> {
  const user = await getSessionUser();
  if (user) return {user, error: null};
  return {user: null, error: NextResponse.json({error: 'authentication required'}, {status: 401})};
}
