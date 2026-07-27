import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { requirePermission } from '@/lib/auth/staff';
import { BRAND } from '@/lib/brand';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * A driver who does have a staff account (UR-004).
 *
 * They see the routes assigned to them and nothing else — no admin nav, no other
 * van. Stops are still tapped through the magic link, because the link is what
 * the office can revoke mid-run and a staff session is not.
 */
export default async function DriverHomePage() {
  const context = await requirePermission('routes.drive');

  const routes = await db.deliveryRoute.findMany({
    where: { driverStaffUserId: context.acting.id, status: { not: 'COMPLETED' } },
    include: { stops: { select: { status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <p className="text-sm font-medium text-[var(--color-brand)]">{BRAND.organization}</p>
      <h1 className="mt-1 text-2xl font-semibold">Driver</h1>
      <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
        Signed in as {context.acting.fullName}.
      </p>

      {routes.length === 0 ? (
        <Card className="mt-6" data-testid="driver-no-routes">
          <CardTitle>No routes assigned</CardTitle>
          <CardDescription>
            When the office puts you on a van it appears here, and they will send you the link that
            opens the stops.
          </CardDescription>
        </Card>
      ) : (
        <ul className="mt-6 space-y-2" data-testid="driver-route-list">
          {routes.map((route) => (
            <li
              key={route.id}
              className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm"
              data-testid="driver-route-row"
              data-route-id={route.id}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-medium">{route.label}</span>
                <Badge>{route.status.replace('_', ' ').toLowerCase()}</Badge>
              </span>
              <span className="mt-1 block text-[var(--color-ink-muted)]">
                {route.stops.filter((stop) => stop.status === 'DELIVERED').length}/
                {route.stops.length} delivered
                {route.deliveryDay ? ` · ${route.deliveryDay}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
