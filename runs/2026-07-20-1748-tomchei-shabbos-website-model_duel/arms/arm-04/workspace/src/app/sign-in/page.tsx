import Link from 'next/link';

import { LocalSignInForm } from './local-sign-in-form';
import { BRAND } from '@/lib/brand';
import { isSetupLocked } from '@/lib/bootstrap';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  if (!(await isSetupLocked())) {
    return (
      <Shell>
        <p className="text-sm text-[var(--color-ink-muted)]">
          No staff accounts exist yet.{' '}
          <Link href="/setup" className="text-[var(--color-brand)] underline">
            Run first-run setup
          </Link>
          .
        </p>
      </Shell>
    );
  }

  if (env.AUTH_PROVIDER === 'clerk') {
    const { SignIn } = await import('@clerk/nextjs');
    return (
      <Shell>
        <SignIn />
      </Shell>
    );
  }

  return (
    <Shell>
      <LocalSignInForm next={next ?? '/admin'} />
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-sm font-medium text-[var(--color-brand)]">{BRAND.organization}</p>
      <h1 className="mt-1 text-2xl font-semibold">Staff sign in</h1>
      <div className="mt-8">{children}</div>
    </main>
  );
}
