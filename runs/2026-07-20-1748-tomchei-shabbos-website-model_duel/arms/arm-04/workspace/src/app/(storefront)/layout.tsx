import { SiteFooter } from '@/components/storefront/site-footer';
import { SiteHeader } from '@/components/storefront/site-header';
import { closedStoreMessage, readStoreState } from '@/lib/store-state';

export const dynamic = 'force-dynamic';

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const store = await readStoreState();

  return (
    <div className="flex min-h-full flex-col">
      <SiteHeader isStoreOpen={store.isOpen} />

      {store.isOpen ? null : (
        <p
          className="bg-[var(--color-warning-soft)] px-4 py-2 text-center text-sm text-[var(--color-warning)]"
          data-testid="closed-banner"
        >
          {closedStoreMessage(store)} Browsing stays open all year.
        </p>
      )}

      {store.announcement ? (
        <p className="bg-[var(--color-brand-soft)] px-4 py-2 text-center text-sm text-[var(--color-brand-strong)]">
          {store.announcement}
        </p>
      ) : null}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10">{children}</main>

      <SiteFooter />
    </div>
  );
}
