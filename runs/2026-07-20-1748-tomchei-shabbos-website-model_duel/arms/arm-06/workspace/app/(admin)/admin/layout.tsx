import { forbidden } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { BRAND } from "@/lib/brand";
import { Sidebar, SidebarItem } from "@/components/admin/sidebar";
import { ImpersonationBanner } from "@/components/admin/impersonation-banner";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();

  // Driver-role users see no admin at all (merged plan smoke).
  if (!hasPermission(ctx.staff, "admin.access")) forbidden();

  const items: SidebarItem[] = [{ href: "/admin", label: "Dashboard" }];
  if (hasPermission(ctx.staff, "staff.manage")) items.push({ href: "/admin/staff", label: "Staff" });
  if (hasPermission(ctx.staff, "audit.view")) items.push({ href: "/admin/audit", label: "Audit log" });

  return (
    <div className="flex min-h-screen flex-col">
      {ctx.impersonator && (
        <ImpersonationBanner targetEmail={ctx.staff.email} impersonatorEmail={ctx.impersonator.email} />
      )}
      <header className="bg-brand-900 text-white">
        <div className="flex items-center justify-between px-4 py-3">
          <span className="font-semibold">{BRAND.orgName} admin</span>
          <span className="text-sm text-brand-100">
            {ctx.staff.name} · {ctx.staff.role}
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
