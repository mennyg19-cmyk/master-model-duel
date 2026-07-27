import { driverDeliveredAction, submitPinAction } from './actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { BRAND } from '@/lib/brand';
import { driverSessionMatches } from '@/lib/routing/driver-session';
import { findLinkByToken, linkNeedsPin } from '@/lib/routing/route-links';
import { readRouteForLink } from '@/lib/routing/route-view';

export const dynamic = 'force-dynamic';

/**
 * The driver's phone (UR-004, UR-015, G-025, G-030).
 *
 * One route, one screen, no account. Everything a volunteer needs while
 * double-parked is on it: who is next, the address, a tap that opens Google Maps
 * and a tap that says it is done. Nothing else is reachable from here — no other
 * route, no customer list, no admin.
 *
 * A dead, revoked or wrong token renders the same "nothing here" as a link that
 * never existed, so guessing tokens tells a stranger nothing.
 */
export default async function DriverRoutePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  const [{ token }, flash] = await Promise.all([params, searchParams]);
  const link = await findLinkByToken(token);

  if (!link) {
    return (
      <Shell>
        <Card data-testid="driver-link-dead">
          <CardTitle>This link is not live</CardTitle>
          <CardDescription>
            It may have finished, been taken back, or never have been one of ours. Ring the office
            and they will send another.
          </CardDescription>
        </Card>
      </Shell>
    );
  }

  if (linkNeedsPin(link) && !(await driverSessionMatches(link.id))) {
    return (
      <Shell>
        <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="driver" />
        <Card data-testid="driver-pin-gate">
          <CardTitle>Enter your PIN</CardTitle>
          <CardDescription>
            The four digits the office sent with this link. Five wrong tries locks it for a few
            minutes.
          </CardDescription>

          <form action={submitPinAction} className="mt-4 flex items-end gap-3">
            <input type="hidden" name="token" value={token} />
            <div>
              <Label htmlFor="pin">PIN</Label>
              <Input
                id="pin"
                name="pin"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={4}
                required
              />
            </div>
            <Button type="submit" data-testid="driver-pin-submit">
              Open my route
            </Button>
          </form>
        </Card>
      </Shell>
    );
  }

  const route = await readRouteForLink(link.routeId);
  if (!route) {
    return (
      <Shell>
        <Card data-testid="driver-route-missing">
          <CardTitle>This route is gone</CardTitle>
          <CardDescription>Ring the office.</CardDescription>
        </Card>
      </Shell>
    );
  }

  const next = route.stops.find((stop) => stop.status === 'PENDING');

  return (
    <Shell>
      <div>
        <h1 className="text-2xl font-semibold">{route.label}</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]" data-testid="driver-progress">
          {route.deliveredCount} of {route.stops.length} delivered
          {route.deliveryDay ? ` · ${route.deliveryDay}` : ''}
        </p>
      </div>

      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="driver" />

      {next === undefined ? (
        <Card data-testid="driver-all-done">
          <CardTitle>Every stop is done</CardTitle>
          <CardDescription>Thank you. Hand the sheet back to the office.</CardDescription>
        </Card>
      ) : null}

      <ol className="space-y-3" data-testid="driver-stops">
        {route.stops.map((stop) => (
          <li
            key={stop.id}
            className="rounded-md border border-[var(--color-line)] p-3"
            data-testid="driver-stop"
            data-stop-id={stop.id}
            data-status={stop.status}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">
                  {stop.sequence + 1}. {stop.recipientName}
                </p>
                <p className="text-sm text-[var(--color-ink-muted)]">{stop.addressLine}</p>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                  {stop.itemCount} item(s)
                  {stop.deliveryWindow ? ` · ${stop.deliveryWindow}` : ''}
                </p>
              </div>
              {stop.status === 'DELIVERED' ? <Badge tone="success">done</Badge> : null}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              {stop.mapsHref ? (
                <a
                  href={stop.mapsHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm underline underline-offset-4"
                  data-testid="driver-maps-link"
                >
                  Directions
                </a>
              ) : null}

              {stop.contactPhone ? (
                <a
                  href={`tel:${stop.contactPhone}`}
                  className="text-sm underline underline-offset-4"
                  data-testid="driver-call-link"
                >
                  Call {stop.contactPhone}
                </a>
              ) : null}

              {stop.status === 'PENDING' ? (
                <form action={driverDeliveredAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="stopId" value={stop.id} />
                  <Button type="submit" data-testid="driver-delivered">
                    Delivered
                  </Button>
                </form>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-md space-y-4 px-4 py-8">
      <p className="text-sm font-medium text-[var(--color-brand)]">{BRAND.organization}</p>
      {children}
    </main>
  );
}
