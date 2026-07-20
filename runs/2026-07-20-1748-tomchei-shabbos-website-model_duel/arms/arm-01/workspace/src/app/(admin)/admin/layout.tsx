import Link from "next/link";
import { StopImpersonationButton } from "@/components/stop-impersonation-button";
import { getCurrentStaffUser } from "@/lib/auth";
import { brand } from "@/lib/brand";
import { hasPermission } from "@/lib/permissions";
import { getAdminSettings } from "@/lib/store-settings";

export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const staffSession = await getCurrentStaffUser();
  if (!staffSession || !hasPermission(staffSession.effective, "admin:view")) {
    return (
      <main className="grid min-h-screen place-items-center bg-[var(--surface)] px-6">
        <div className="max-w-md rounded-3xl border border-[var(--border)] bg-white p-10 text-center">
          <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--danger)]">
            403 · Access denied
          </p>
          <h1 className="mt-4 text-3xl font-bold">Staff portal unavailable</h1>
          <p className="mt-3 text-[var(--muted)]">
            Your account does not have admin access, or it has been revoked.
          </p>
        </div>
      </main>
    );
  }

  const adminSettings = await getAdminSettings();
  const isImpersonating =
    staffSession.actor.id !== staffSession.effective.id;
  return (
    <div className="min-h-screen bg-[var(--surface)]">
      {isImpersonating && (
        <div className="bg-[var(--warning)] px-4 py-2 text-center text-sm font-bold text-[var(--ink)]">
          Impersonating {staffSession.effective.displayName}. Actions remain
          attributed to {staffSession.actor.displayName}.
          <StopImpersonationButton />
        </div>
      )}
      <header className="border-b border-white/10 bg-[var(--ink)] text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4">
          <Link href="/" className="font-bold">
            {brand.name} <span className="text-[var(--brand-light)]">Admin</span>
          </Link>
          <div className="flex items-center gap-5 text-right text-sm">
            <Link className="font-semibold text-[var(--brand-light)] hover:text-white" href="/">
              Visit store ↗
            </Link>
            <div>
              <p className="font-semibold">{staffSession.effective.displayName}</p>
              <p className="text-white/60">{staffSession.effective.role}</p>
            </div>
          </div>
        </div>
      </header>
      <div className="border-b border-amber-200 bg-amber-50 px-5 py-2 text-center text-sm font-semibold text-amber-950">
        {adminSettings.operationsAlert}
      </div>
      <div className="mx-auto grid max-w-7xl md:grid-cols-[220px_1fr]">
        <aside className="border-r border-[var(--border)] bg-white p-5">
          <nav className="flex gap-2 overflow-x-auto md:flex-col">
            <Link className="rounded-xl bg-[var(--brand-soft)] px-4 py-3 font-semibold text-[var(--brand-dark)]" href="/admin">
              Overview
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/today">
              Today
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/orders">
              Orders
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/pos">
              POS
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/customers">
              Customers
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/imports">
              Imports
            </Link>
            <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/audit">
              Audit
            </Link>
            {hasPermission(staffSession.effective, "settings:manage") && (
              <>
                <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/catalog">
                  Catalog
                </Link>
                <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/media">
                  Media
                </Link>
                <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/settings">
                  Settings
                </Link>
              </>
            )}
            {hasPermission(staffSession.effective, "staff:manage") && (
              <Link className="rounded-xl px-4 py-3 font-semibold hover:bg-[var(--surface)]" href="/admin/staff">
                Staff & access
              </Link>
            )}
          </nav>
        </aside>
        <main className="min-w-0 p-5 md:p-10">{children}</main>
      </div>
    </div>
  );
}
