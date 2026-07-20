import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  await requirePermission("admin:view");
  const events = await db.auditLog.findMany({
    orderBy: [{ occurredAt: "desc" }, { id: "asc" }],
    take: 200,
  });
  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">Accountability</p>
      <h1 className="mt-2 text-4xl font-black">Audit trail</h1>
      <p className="mt-3 text-[var(--muted)]">Newest 200 staff and system events.</p>
      <div className="mt-7 divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-white">
        {events.map((event) => (
          <div className="grid gap-2 p-4 md:grid-cols-[1fr_220px]" key={event.id}>
            <div><p className="font-bold">{event.action}</p><p className="text-sm text-[var(--muted)]">{event.targetType} · {event.targetId}</p></div>
            <div className="text-sm md:text-right"><p>{event.occurredAt.toLocaleString()}</p><p className="text-[var(--muted)]">{event.actorStaffId ?? "System"}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}
