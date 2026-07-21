import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { listAudit } from "@/lib/audit";

export default async function AuditPage() {
  try {
    await requireAdminPage("audit.read");
    const entries = await listAudit({ limit: 50 });
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Audit log
        </h1>
        <ul className="space-y-2">
          {entries.map((entry) => {
            const actorName = entry.actor?.displayName ?? "—";
            const target =
              "target" in entry && entry.target && typeof entry.target === "object"
                ? (entry.target as { displayName?: string | null }).displayName
                : null;
            const createdAt =
              entry.createdAt instanceof Date
                ? entry.createdAt.toISOString()
                : String(entry.createdAt);
            return (
              <li
                key={entry.id}
                className="rounded-[var(--radius-md)] bg-white p-3 text-sm shadow-sm"
              >
                <strong>{entry.action}</strong> · {createdAt}
                <div className="opacity-70">
                  actor: {actorName} → target: {target ?? "—"}
                </div>
              </li>
            );
          })}
        </ul>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
