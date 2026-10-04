import {NextRequest, NextResponse} from 'next/server';
import {jwtVerify} from 'jose';

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/api/auth/login',
  '/api/auth/signup',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/health',
  '/sw.js',
  '/manifest.webmanifest',
];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

async function hasSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get('pl_session')?.value;
  if (!token) return false;
  try {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return false;
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const {pathname} = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();
  if (await hasSession(req)) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({error: 'authentication required'}, {status: 401});
  }
  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.search = '';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|ico)$).*)'],
};
