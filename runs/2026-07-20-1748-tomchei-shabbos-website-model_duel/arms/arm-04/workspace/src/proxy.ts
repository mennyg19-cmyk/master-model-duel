import { type NextFetchEvent, type NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE } from '@/lib/auth/cookie-names';

/**
 * Coarse gate only: it answers "is anyone signed in?" and sends anonymous
 * visitors to sign-in. Real authorization runs server-side in
 * `requirePermission`, because this layer cannot read the database and must
 * never be the only thing standing between a user and a protected page.
 */
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (process.env.AUTH_PROVIDER === 'clerk') {
    const { clerkMiddleware } = await import('@clerk/nextjs/server');
    return clerkMiddleware(async (auth) => {
      await auth.protect();
    })(request, event);
  }

  if (request.cookies.get(SESSION_COOKIE)) return NextResponse.next();

  const signIn = new URL('/sign-in', request.url);
  signIn.searchParams.set('next', request.nextUrl.pathname);
  return NextResponse.redirect(signIn);
}

export const config = {
  matcher: ['/admin/:path*', '/driver/:path*'],
};
