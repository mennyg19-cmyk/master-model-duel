import Link from "next/link";
import { forbidden } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { getOpenSeason } from "@/lib/seasons/queries";
import { BRAND } from "@/lib/brand";
import { Sidebar, SidebarItem } from "@/components/admin/sidebar";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();

  // Driver-role users see no admin at all (merged plan smoke).
  if (!hasPermission(ctx.staff, "admin.access")) forbidden();

  const openSeason = await getOpenSeason();

  const items: SidebarItem[] = [{ href: "/admin", label: "Dashboard" }];
  if (hasPermission(ctx.staff, "payments.manage")) {
    items.push({ href: "/admin/orders", label: "Orders" }, { href: "/admin/pos", label: "POS" });
  }
  if (hasPermission(ctx.staff, "customers.manage")) {
    items.push({ href: "/admin/customers", label: "Customers" });
  }
  if (hasPermission(ctx.staff, "customers.manage") || hasPermission(ctx.staff, "catalog.manage")) {
    items.push({ href: "/admin/imports", label: "Imports" });
  }
  if (hasPermission(ctx.staff, "catalog.manage")) {
    items.push(
      { href: "/admin/products", label: "Products" },
      { href: "/admin/addons", label: "Add-ons" },
      { href: "/admin/media", label: "Media" },
    );
  }
  if (hasPermission(ctx.staff, "settings.manage")) items.push({ href: "/admin/settings", label: "Settings" });
  if (hasPermission(ctx.staff, "staff.manage")) items.push({ href: "/admin/staff", label: "Staff" });
  if (hasPermission(ctx.staff, "audit.view")) items.push({ href: "/admin/audit", label: "Audit log" });

  return (
    <div className="flex min-h-screen flex-col">
      {ctx.impersonator && (
        <ImpersonationBanner targetEmail={ctx.staff.email} impersonatorEmail={ctx.impersonator.email} />
      )}
      {!openSeason && (
        // R-106: the season state is the one fact every admin screen depends
        // on — a closed store is a banner, not a surprise per page.
        <p className="bg-accent-100 px-4 py-2 text-center text-sm font-medium text-amber-900" data-season-closed-banner>
          The store is closed — no open season. Ordering, POS, and product imports are paused until a
          season opens.
        </p>
      )}
      <header className="bg-brand-900 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">{BRAND.orgName} admin</span>
          <span className="flex items-center gap-4 text-sm text-brand-100">
            <Link href="/" className="rounded-md border border-brand-600 px-2.5 py-1 hover:bg-brand-700" data-visit-store>
              Visit store ↗
            </Link>
            <span>
              {ctx.staff.name} · {ctx.staff.role}
            </span>
          </span>
        </div>
      </header>
      <div className="flex flex-1 flex-col md:flex-row">
        <Sidebar items={items} />
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
