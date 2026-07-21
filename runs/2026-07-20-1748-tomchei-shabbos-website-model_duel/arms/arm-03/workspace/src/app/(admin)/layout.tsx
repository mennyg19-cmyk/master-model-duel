import { AdminShell } from "@/components/admin/shell";
import { getStaffContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { OPS_SETTINGS, type AlertBannerSetting } from "@/lib/ops/settings-keys";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();

  if (!ctx || !ctx.permissions.has("admin.access")) {
    return <div data-route-group="admin">{children}</div>;
  }

  const banner = await getSetting<AlertBannerSetting>(OPS_SETTINGS.alertBanner);

  return (
    <div data-route-group="admin">
      <AdminShell
        permissions={ctx.permissions}
        impersonating={ctx.impersonating}
        effectiveName={ctx.effectiveStaff.displayName}
        actorName={ctx.staff.displayName}
        alertBanner={banner}
      >
        {children}
      </AdminShell>
    </div>
  );
}
