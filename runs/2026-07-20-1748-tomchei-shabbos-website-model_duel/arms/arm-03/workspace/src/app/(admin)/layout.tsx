import { AdminShell } from "@/components/admin/shell";
import { getStaffContext } from "@/lib/auth";
import { getSetting } from "@/lib/settings";
import { OPS_SETTINGS, type AlertBannerSetting } from "@/lib/ops/settings-keys";
import { getTestMode } from "@/lib/ops/test-ops";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();

  if (!ctx || !ctx.permissions.has("admin.access")) {
    return <div data-route-group="admin">{children}</div>;
  }

  const banner = await getSetting<AlertBannerSetting>(OPS_SETTINGS.alertBanner);
  const testMode = await getTestMode();
  const alertBanner = testMode.enabled
    ? {
        message: "TEST MODE — destructive ops enabled; data may be wiped.",
        tone: "warn" as const,
        active: true,
      }
    : banner;

  return (
    <div data-route-group="admin" data-test-mode={testMode.enabled ? "true" : "false"}>
      <AdminShell
        permissions={ctx.permissions}
        impersonating={ctx.impersonating}
        effectiveName={ctx.effectiveStaff.displayName}
        actorName={ctx.staff.displayName}
        alertBanner={alertBanner}
      >
        {children}
      </AdminShell>
    </div>
  );
}
