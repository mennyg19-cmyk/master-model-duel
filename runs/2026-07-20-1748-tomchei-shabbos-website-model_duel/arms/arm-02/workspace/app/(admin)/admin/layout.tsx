import Link from "next/link";
import { redirect } from "next/navigation";
import { getStaffContext } from "@/lib/auth/current-user";
import { getOpenSeason } from "@/lib/season";
import type { Permission } from "@/lib/auth/permissions";
import { BRAND } from "@/lib/brand";
import { Badge } from "@/components/ui/badge";
import { StopImpersonationButton, LogoutButton } from "@/components/session-buttons";

const NAV_ITEMS: { href: string; label: string; permission: Permission | null }[] = [
  { href: "/admin", label: "Dashboard", permission: null },
  { href: "/admin/orders", label: "Orders", permission: "orders.view" },
  { href: "/admin/pos", label: "Point of sale", permission: "orders.manage" },
  { href: "/admin/packages", label: "Packages", permission: "fulfillment.manage" },
  { href: "/admin/fulfillment", label: "Fulfillment", permission: "fulfillment.manage" },
  { href: "/admin/customers", label: "Customers", permission: "customers.manage" },
  { href: "/admin/import", label: "Import", permission: "customers.manage" },
  { href: "/admin/catalog", label: "Catalog", permission: "catalog.manage" },
  { href: "/admin/media", label: "Media", permission: "media.manage" },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage" },
  { href: "/admin/audit", label: "Audit log", permission: "audit.view" },
  { href: "/admin/settings", label: "Settings", permission: "settings.manage" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await getStaffContext();
  if (!staff) redirect("/login?next=/admin");
  // Drivers have no admin surface — including a manager impersonating a driver,
  // who should see exactly what the driver sees (/driver).
  if (staff.actingAs.role === "DRIVER") redirect("/driver");

  const visibleNavItems = NAV_ITEMS.filter(
    (item) => item.permission === null || staff.actingAs.permissions.has(item.permission)
  );
  // Alert banner (R-106): remind staff when customers currently see the closed store.
  const openSeason = await getOpenSeason();

  return (
    <div className="flex-1 flex flex-col">
      {!openSeason && (
        <div className="bg-amber-100 px-4 py-2 text-sm text-amber-900" data-testid="admin-alert-banner">
          No season is open — the storefront shows the closed notice. Open a season under Settings.
        </div>
      )}
      {staff.isImpersonating && (
        <div className="bg-accent text-white px-4 py-2 text-sm flex items-center justify-between gap-3">
          <span>
            Impersonating <strong>{staff.actingAs.name}</strong> ({staff.actingAs.email}) as{" "}
            {staff.realUser.email}. Every action is audited.
          </span>
          <StopImpersonationButton />
        </div>
      )}
      <div className="flex flex-1">
        <aside className="w-52 shrink-0 border-r border-border bg-surface p-4 flex flex-col gap-1">
          <div className="mb-4">
            <p className="font-semibold text-brand-strong">{BRAND.shortName}</p>
            <p className="text-xs text-muted">Admin</p>
          </div>
          {visibleNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-md px-3 py-1.5 text-sm hover:bg-brand-soft"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/"
            className="mt-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted hover:bg-brand-soft"
          >
            Visit store ↗
          </Link>
          <div className="mt-auto pt-4 border-t border-border text-xs text-muted">
            <p className="truncate">{staff.actingAs.email}</p>
            <Badge tone="brand" className="mt-1">{staff.actingAs.role}</Badge>
            <div className="mt-2">
              <LogoutButton />
            </div>
          </div>
        </aside>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
