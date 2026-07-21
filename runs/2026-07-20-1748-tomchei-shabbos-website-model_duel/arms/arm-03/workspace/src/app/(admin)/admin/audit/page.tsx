import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { db } from "@/lib/db";

export default async function AuditPage() {
  try {
    await requireAdminPage("audit.read");
    const entries = await db.auditLog.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: {
        actor: { select: { displayName: true, email: true } },
        target: { select: { displayName: true, email: true } },
      },
    });
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Audit log
        </h1>
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="rounded-[var(--radius-md)] bg-white p-3 text-sm shadow-sm">
              <strong>{entry.action}</strong> · {entry.createdAt.toISOString()}
              <div className="opacity-70">
                actor: {entry.actor?.displayName ?? "—"} → target:{" "}
                {entry.target?.displayName ?? "—"}
              </div>
            </li>
          ))}
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
