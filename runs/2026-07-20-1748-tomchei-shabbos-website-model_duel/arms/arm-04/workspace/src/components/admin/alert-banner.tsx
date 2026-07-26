import Link from 'next/link';

import { readStoreState } from '@/lib/store-state';

/**
 * The one thing staff must know before they read anything else (R-106).
 *
 * The store being shut is invisible from inside the admin — every screen still
 * works — and the failure it causes is a phone call at four in the afternoon
 * asking why the website will not take an order. So it is said at the top of
 * every admin page, with the switch one click away for whoever can throw it.
 *
 * Everyone is told; only a manager is offered the link. An admin screen never
 * shows a link to a page that answers 403, which is the same rule the sidebar
 * follows.
 */
export async function AlertBanner({ canOpenSettings }: { canOpenSettings: boolean }) {
  const store = await readStoreState();
  if (store.isOpen) return null;

  const reason = !store.season
    ? 'No season has been set up yet, so nobody can order.'
    : !store.seasonIsOpen
      ? `${store.season.label} is ${store.season.status.toLowerCase()}, so the store is not taking orders.`
      : 'Ordering is paused. Browsing still works.';

  return (
    <div
      role="status"
      className="bg-[var(--color-warning-soft)] px-4 py-2 text-center text-sm text-[var(--color-ink)]"
      data-testid="admin-alert"
    >
      {reason}
      {canOpenSettings ? (
        <>
          {' '}
          <Link href="/admin/settings" className="underline underline-offset-4">
            Settings
          </Link>
        </>
      ) : null}
    </div>
  );
}
