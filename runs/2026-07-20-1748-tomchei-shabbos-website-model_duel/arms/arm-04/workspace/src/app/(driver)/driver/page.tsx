import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { BRAND } from '@/lib/brand';
import { requirePermission } from '@/lib/auth/staff';

export const dynamic = 'force-dynamic';

export default async function DriverHomePage() {
  const context = await requirePermission('routes.drive');

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-sm font-medium text-[var(--color-brand)]">{BRAND.organization}</p>
      <h1 className="mt-1 text-2xl font-semibold">Driver</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Signed in as {context.acting.fullName}.
      </p>

      <Card className="mt-6">
        <CardTitle>No routes assigned</CardTitle>
        <CardDescription>
          Route assignment and per-stop delivery arrive in a later release. Drivers see only their own
          route and never the admin.
        </CardDescription>
      </Card>
    </main>
  );
}
