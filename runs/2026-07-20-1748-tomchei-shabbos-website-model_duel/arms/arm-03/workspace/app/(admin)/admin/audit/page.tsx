import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { Card, CardTitle } from "@/components/ui/card";

export default async function AuditLogPage() {
  await requirePermissionPage("audit.view");
  const entries = await db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 100 });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Audit log</h1>
      <Card>
        <CardTitle>Latest 100 entries</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted border-b border-border">
              <th className="py-2 pr-3">When</th>
              <th className="py-2 pr-3">Actor</th>
              <th className="py-2 pr-3">Action</th>
              <th className="py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-border align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{entry.createdAt.toISOString()}</td>
                <td className="py-2 pr-3">{entry.actorEmail}</td>
                <td className="py-2 pr-3 font-mono text-xs">{entry.action}</td>
                <td className="py-2 font-mono text-xs break-all">
                  {entry.detail ? JSON.stringify(entry.detail) : ""}
                </td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td colSpan={4} className="py-4 text-muted">No audit entries yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
