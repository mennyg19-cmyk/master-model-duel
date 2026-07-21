import Link from "next/link";
import { brand } from "@/lib/brand";
import type { Permission } from "@/lib/permissions";
import { StopImpersonationButton } from "@/components/admin/stop-impersonation-button";

const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin", label: "Dashboard", permission: "admin.access" },
  { href: "/admin/today", label: "Today", permission: "admin.access" },
  { href: "/admin/orders", label: "Orders", permission: "admin.access" },
  { href: "/admin/packages", label: "Packages", permission: "admin.access" },
  { href: "/admin/fulfillment", label: "Fulfillment", permission: "admin.access" },
  { href: "/admin/routes", label: "Routes", permission: "admin.access" },
  { href: "/admin/print-batches", label: "Print", permission: "admin.access" },
  { href: "/admin/reports", label: "Reports", permission: "admin.access" },
  { href: "/admin/exports", label: "Exports", permission: "settings.write" },
  { href: "/admin/reconcile", label: "Reconcile", permission: "settings.write" },
  { href: "/admin/customers", label: "Customers", permission: "admin.access" },
  { href: "/admin/pos", label: "POS", permission: "admin.access" },
  { href: "/admin/imports", label: "Imports", permission: "settings.write" },
  { href: "/admin/catalog", label: "Catalog", permission: "settings.write" },
  { href: "/admin/seasons", label: "Seasons", permission: "settings.write" },
  { href: "/admin/media", label: "Media", permission: "settings.write" },
  { href: "/admin/test-ops", label: "Test ops", permission: "settings.write" },
  { href: "/admin/help", label: "Help", permission: "admin.access" },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage" },
  { href: "/admin/audit", label: "Audit", permission: "audit.read" },
  { href: "/admin/email", label: "Email", permission: "settings.read" },
  { href: "/admin/settings", label: "Settings", permission: "settings.read" },
];

export function AdminShell({
  children,
  permissions,
  impersonating,
  effectiveName,
  actorName,
  alertBanner,
}: {
  children: React.ReactNode;
  permissions: Set<Permission> | Permission[];
  impersonating?: boolean;
  effectiveName?: string;
  actorName?: string;
  alertBanner?: { message: string; tone?: "info" | "warn"; active?: boolean } | null;
}) {
  const allowed = permissions instanceof Set ? permissions : new Set(permissions);
  const links = NAV.filter((item) => allowed.has(item.permission));
  const showBanner = Boolean(alertBanner?.active && alertBanner.message?.trim());

  return (
    <div className="min-h-screen bg-[var(--color-cream)] text-[var(--color-ink)]">
      {impersonating ? (
        <div className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-white">
          You are {actorName} acting as {effectiveName}.{" "}
          <StopImpersonationButton />
        </div>
      ) : null}
      {showBanner ? (
        <div
          className={`px-4 py-2 text-center text-sm font-semibold ${
            alertBanner?.tone === "warn"
              ? "bg-amber-100 text-amber-950"
              : "bg-[var(--color-leaf)]/15 text-[var(--color-forest)]"
          }`}
          data-testid="admin-alert-banner"
        >
          {alertBanner?.message}
        </div>
      ) : null}
      <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="mb-4">
            <p className="font-[family-name:var(--font-display)] text-xl text-[var(--color-forest)]">
              {brand.shortName}
            </p>
            <p className="text-xs text-[var(--color-forest)]/70">Admin</p>
          </div>
          <div className="mb-4 flex flex-col gap-1 text-sm">
            <Link
              href="/"
              className="rounded-[var(--radius-md)] px-3 py-2 font-semibold text-[var(--color-leaf)] hover:bg-white"
              data-testid="visit-store-link"
            >
              Visit store →
            </Link>
            <Link
              href="/admin"
              className="rounded-[var(--radius-md)] px-3 py-2 text-xs font-medium opacity-70 hover:bg-white"
              data-testid="admin-back-link"
            >
              ← Admin home
            </Link>
          </div>
          <nav className="flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium hover:bg-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="flex-1">
          <nav className="mb-4 flex gap-2 overflow-x-auto md:hidden">
            <Link
              href="/"
              className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm font-semibold text-[var(--color-leaf)]"
            >
              Store
            </Link>
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
