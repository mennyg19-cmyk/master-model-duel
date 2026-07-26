import Link from 'next/link';

import { STOREFRONT_NAV } from './nav-items';
import { UserMenu } from './user-menu';
import { BRAND } from '@/lib/brand';

/**
 * Sticky so the nav is reachable half way down a long catalog page. The mobile
 * menu is a `<details>` element rather than a JavaScript drawer: it opens on a
 * phone with no client bundle and keeps its keyboard behaviour for free.
 */
export function SiteHeader({ isStoreOpen }: { isStoreOpen: boolean }) {
  return (
    <header className="sticky top-0 z-40 border-b border-[var(--color-brand-strong)] bg-[var(--color-brand)] text-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-semibold">
          {BRAND.organization}
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-5 text-sm md:flex">
          {STOREFRONT_NAV.map((item) => (
            <Link key={item.href} href={item.href} className="hover:underline underline-offset-4">
              {item.label}
            </Link>
          ))}
          {isStoreOpen ? (
            <Link
              href="/order"
              className="rounded-md bg-white px-3 py-1.5 font-medium text-[var(--color-brand)]"
              data-testid="header-order-cta"
            >
              Start an order
            </Link>
          ) : null}
        </nav>

        <div className="hidden text-sm md:block">
          <UserMenu />
        </div>

        <details className="relative md:hidden" data-testid="mobile-menu">
          <summary className="cursor-pointer list-none rounded-md border border-white/40 px-3 py-1.5 text-sm">
            Menu
          </summary>
          <div className="absolute right-0 z-50 mt-2 w-56 rounded-[var(--radius-card)] border border-[var(--color-line)] bg-white p-4 text-sm text-[var(--color-ink)] shadow-lg">
            <nav aria-label="Mobile" className="flex flex-col gap-3">
              {STOREFRONT_NAV.map((item) => (
                <Link key={item.href} href={item.href}>
                  {item.label}
                </Link>
              ))}
              {isStoreOpen ? (
                <Link href="/order" className="font-medium text-[var(--color-brand)]">
                  Start an order
                </Link>
              ) : null}
            </nav>
            <div className="mt-3 border-t border-[var(--color-line)] pt-3">
              <UserMenu />
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}
