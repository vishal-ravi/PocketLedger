import {NextRequest, NextResponse} from 'next/server';
import {prisma} from '@/lib/prisma';
import {setSessionCookie} from '@/lib/auth';
import {hashPassword} from '@/lib/password';
import {DEFAULT_CATEGORIES} from '@/lib/defaults';
import {clientIp, hit} from '@/lib/rate-limit';
import {logAuthEvent} from '@/lib/logger';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: NextRequest) {
  let body: {email?: unknown; fullName?: unknown; password?: unknown};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({error: 'invalid JSON body'}, {status: 400});
  }

  const email = String(body.email ?? '').trim().toLowerCase();
  const fullName = String(body.fullName ?? '').trim();
  const password = String(body.password ?? '');

  if (!EMAIL.test(email) || email.length > 160) return NextResponse.json({error: 'Enter a valid email address'}, {status: 400});
  if (fullName.length < 2 || fullName.length > 80) return NextResponse.json({error: 'Name must be 2–80 characters'}, {status: 400});
  if (password.length < 8 || password.length > 200) return NextResponse.json({error: 'Password must be at least 8 characters'}, {status: 400});

  const ip = clientIp(req.headers);
  const limit = hit(`signup:ip:${ip}`, 12, 10 * 60_000);
  if (!limit.ok) {
    return NextResponse.json(
      {error: 'Too many attempts. Please try again later.'},
      {status: 429, headers: {'retry-after': String(limit.retryAfter)}},
    );
  }

  const existing = await prisma.user.findUnique({where: {email}});
  if (existing) return NextResponse.json({error: 'An account with that email already exists'}, {status: 409});

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.create({
    data: {
      email,
      fullName,
      passwordHash,
      categories: {create: DEFAULT_CATEGORIES.map((c) => ({name: c.name, colorCode: c.colorCode}))},
    },
  });

  await setSessionCookie(user.id, user.tokenVersion);
  logAuthEvent('signup_success', {userId: user.id, email, ip});
  return NextResponse.json(
    {
      user: {id: user.id, email: user.email, fullName: user.fullName, currencySymbol: user.currencySymbol},
    },
    {status: 201},
  );
}
