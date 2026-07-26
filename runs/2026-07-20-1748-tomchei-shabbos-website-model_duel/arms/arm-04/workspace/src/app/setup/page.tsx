import { forbidden } from 'next/navigation';

import { SetupForm } from './setup-form';
import { BRAND } from '@/lib/brand';
import { isSetupLocked } from '@/lib/bootstrap';

export const dynamic = 'force-dynamic';

export default async function SetupPage() {
  // Once a manager exists the bootstrap route is closed for good, so it answers
  // 403 rather than quietly rendering a form that can never succeed.
  if (await isSetupLocked()) forbidden();

  return (
    <main className="mx-auto w-full max-w-md px-4 py-16">
      <p className="text-sm font-medium text-[var(--color-brand)]">{BRAND.organization}</p>
      <h1 className="mt-1 text-2xl font-semibold">First-run setup</h1>
      <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
        This database has no staff accounts yet. Create the first manager; after that this page is
        permanently locked and new staff must be invited from inside the admin.
      </p>
      <SetupForm />
    </main>
  );
}
