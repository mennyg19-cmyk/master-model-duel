import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { Card, CardTitle } from "@/components/ui/card";

export default async function SettingsPage() {
  await requirePermissionPage("settings.manage");
  const settings = await db.setting.findMany({ orderBy: { key: "asc" } });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Settings</h1>
      <Card>
        <CardTitle>Organization settings</CardTitle>
        <p className="text-sm text-muted mb-3">
          Typed key-value store. Business settings tabs (orders, shipping, email) arrive with
          their phases.
        </p>
        <table className="w-full text-sm">
          <tbody>
            {settings.map((setting) => (
              <tr key={setting.key} className="border-b border-border">
                <td className="py-2 pr-3 font-mono text-xs">{setting.key}</td>
                <td className="py-2 font-mono text-xs">{JSON.stringify(setting.value)}</td>
              </tr>
            ))}
            {settings.length === 0 && (
              <tr>
                <td className="py-4 text-muted">No settings stored yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
