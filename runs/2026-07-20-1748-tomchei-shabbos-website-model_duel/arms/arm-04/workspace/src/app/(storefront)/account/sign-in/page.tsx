import Link from 'next/link';
import { redirect } from 'next/navigation';

import { CustomerSignInForm } from './customer-sign-in-form';
import { getCurrentCustomer } from '@/lib/customers';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Customer sign-in, separate from `/sign-in` because staff and customers are
 * separate tables and separate journeys (UR-012): a customer who signs in here
 * gains an address book and an order history, never staff access.
 *
 * Signing in is also where a guest's cart is claimed, which is why nothing on the
 * storefront asks for an account before checkout (R-022).
 */
export default async function CustomerSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, customer] = await Promise.all([searchParams, getCurrentCustomer()]);
  if (customer) redirect(next ?? '/account');

  return (
    <div className="mx-auto max-w-md space-y-6">
      <header className="space-y-1">
        <h1 className="text-3xl font-semibold">Sign in</h1>
        <p className="text-[var(--color-ink-muted)]">
          Your account keeps your address book and your order history. Anything already in your cart
          comes with you.
        </p>
      </header>

      {env.AUTH_PROVIDER === 'clerk' ? <ClerkSignIn /> : <CustomerSignInForm next={next ?? '/account'} />}

      <p className="text-sm text-[var(--color-ink-muted)]">
        Volunteer or office staff?{' '}
        <Link href="/sign-in" className="underline underline-offset-4">
          Staff sign in
        </Link>
        .
      </p>
    </div>
  );
}

async function ClerkSignIn() {
  const { SignIn } = await import('@clerk/nextjs');
  return <SignIn />;
}
