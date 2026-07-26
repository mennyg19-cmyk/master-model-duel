import Link from 'next/link';

import { ImpersonationBanner } from './impersonation-banner';
import { signOut } from '../../sign-in/actions';
import { ADMIN_NAV } from '@/components/admin/nav-items';
import { Badge } from '@/components/ui/badge';
import { ADMIN_TITLE } from '@/lib/brand';
import { requirePermission } from '@/lib/auth/staff';

export const dynamic = 'force-dynamic';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // The shell itself is gated: a driver who opens /admin must get the 403 page,
  // not the admin header and an empty sidebar wrapped around it.
  const context = await requirePermission('dashboard.view');
  const visibleNav = ADMIN_NAV.filter((navItem) => context.permissions.includes(navItem.permission));

  return (
    <div className="flex min-h-full flex-col">
      {context.isImpersonating ? (
        <ImpersonationBanner
          actorName={context.actor.fullName}
          impersonatedName={context.acting.fullName}
        />
      ) : null}

      <header className="border-b border-[var(--color-line)] bg-[var(--color-brand)] text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link href="/admin" className="font-semibold">
            {ADMIN_TITLE}
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <Link href="/" className="underline">
              Visit store
            </Link>
            <span className="hidden sm:inline">{context.acting.email}</span>
            <Badge tone="neutral">{context.acting.role}</Badge>
            <form action={signOut}>
              <button type="submit" className="underline">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Mobile nav: the same permission-filtered links, scrolled horizontally. */}
        <nav className="mx-auto flex max-w-6xl gap-4 overflow-x-auto px-4 pb-2 text-sm md:hidden">
          {visibleNav.map((navItem) => (
            <Link key={navItem.href} href={navItem.href} className="whitespace-nowrap">
              {navItem.label}
            </Link>
          ))}
        </nav>
      </header>

      <div className="mx-auto flex w-full max-w-6xl flex-1 gap-8 px-4 py-8">
        <aside className="hidden w-48 shrink-0 md:block">
          <nav className="space-y-1">
            {visibleNav.map((navItem) => (
              <Link
                key={navItem.href}
                href={navItem.href}
                className="block rounded-md px-3 py-2 text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-muted)]"
              >
                {navItem.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
