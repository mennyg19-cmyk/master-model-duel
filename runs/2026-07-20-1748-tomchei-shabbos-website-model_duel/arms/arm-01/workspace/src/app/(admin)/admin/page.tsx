import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [activeStaff, pendingInvites, auditEvents] = await Promise.all([
    db.staffUser.count({ where: { status: "ACTIVE" } }),
    db.staffUser.count({ where: { status: "INVITED" } }),
    db.auditLog.findMany({
      orderBy: { occurredAt: "desc" },
      take: 6,
    }),
  ]);

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Operations foundation
      </p>
      <h1 className="mt-2 text-4xl font-bold tracking-tight text-[var(--ink)]">
        Good evening
      </h1>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <article className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <p className="text-sm font-semibold text-[var(--muted)]">Active staff</p>
          <p className="mt-2 text-4xl font-bold">{activeStaff}</p>
        </article>
        <article className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <p className="text-sm font-semibold text-[var(--muted)]">Pending invitations</p>
          <p className="mt-2 text-4xl font-bold">{pendingInvites}</p>
        </article>
      </div>
      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-xl font-bold">Recent security activity</h2>
        <div className="mt-5 divide-y divide-[var(--border)]">
          {auditEvents.map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-4 py-4">
              <div>
                <p className="font-semibold">{event.action}</p>
                <p className="text-sm text-[var(--muted)]">
                  {event.targetType} · {event.targetId}
                </p>
              </div>
              <time className="text-sm text-[var(--muted)]">
                {event.occurredAt.toLocaleString()}
              </time>
            </div>
          ))}
          {auditEvents.length === 0 && (
            <p className="py-8 text-center text-[var(--muted)]">No activity yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
