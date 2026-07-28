import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

const actionTones: Record<string, "brand" | "green" | "amber" | "red" | "stone"> = {
  bootstrap_manager: "brand",
  staff_create: "green",
  staff_confirm: "green",
  role_change: "amber",
  permission_override: "amber",
  staff_revoke: "red",
  impersonation_start: "red",
  impersonation_stop: "amber",
  session_login: "stone",
  client_error: "stone",
};

export default async function AuditLogPage() {
  await requirePermission("audit.view");
  const entries = await prisma.auditLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">Time</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Action</th>
              <th className="px-4 py-3">Target</th>
              <th className="px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-2.5 whitespace-nowrap text-stone-500">
                  {entry.createdAt.toLocaleString("en-US")}
                </td>
                <td className="px-4 py-2.5 text-stone-700">{entry.actorEmail ?? "system"}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={actionTones[entry.action] ?? "stone"}>{entry.action}</Badge>
                </td>
                <td className="px-4 py-2.5 text-stone-500">
                  {entry.targetType ? `${entry.targetType} ${entry.targetId ?? ""}` : "—"}
                </td>
                <td className="max-w-xs truncate px-4 py-2.5 text-xs text-stone-500">
                  {entry.metadata === null ? "—" : JSON.stringify(entry.metadata)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
