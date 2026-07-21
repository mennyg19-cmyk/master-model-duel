import { AdminShell } from "@/components/admin/shell";
import { getStaffContext } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();

  if (!ctx || !ctx.permissions.has("admin.access")) {
    return <div data-route-group="admin">{children}</div>;
  }

  return (
    <div data-route-group="admin">
      <AdminShell
        permissions={ctx.permissions}
        impersonating={ctx.impersonating}
        effectiveName={ctx.effectiveStaff.displayName}
        actorName={ctx.staff.displayName}
      >
        {children}
      </AdminShell>
    </div>
  );
}
