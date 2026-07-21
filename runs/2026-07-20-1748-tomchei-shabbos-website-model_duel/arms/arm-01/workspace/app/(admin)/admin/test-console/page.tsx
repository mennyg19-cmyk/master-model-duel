import { notFound } from "next/navigation";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { isTestMode } from "@/lib/test-mode";
import { db } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { TestConsoleClient } from "@/components/admin/test-console-client";

// Test-environment console (R-014, R-101, R-103, R-129). Only exists in test
// mode — a live configuration 404s the whole page, matching the API.

export default async function TestConsolePage() {
  if (!isTestMode()) notFound();
  await requirePermissionPage("settings.manage");

  const season = await db.season.findFirst({ where: { status: "OPEN" }, orderBy: { createdAt: "desc" } });
  const [orders, packages, notifications] = season
    ? await Promise.all([
        db.order.count({ where: { seasonId: season.id } }),
        db.package.count({ where: { seasonId: season.id } }),
        db.notification.count(),
      ])
    : [0, 0, 0];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Test console</h1>
        <p className="text-sm text-muted">
          This app is running in <strong>test mode</strong> (mock Stripe — no real money moves).
          These destructive tools do not exist in a live configuration: set STRIPE_SECRET_KEY and
          unset TEST_MODE and this page (and its API) turn into a 404.
        </p>
      </div>

      <Card>
        <CardTitle>Open season state</CardTitle>
        {season ? (
          <p className="text-sm" data-testid="test-season-state">
            <strong>{season.name}</strong>: {orders} orders · {packages} packages · {notifications}{" "}
            notification rows (all seasons).
          </p>
        ) : (
          <p className="text-sm text-muted">No season is open.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Reset tools</CardTitle>
        <p className="text-sm text-muted mb-3">
          Wipe removes every transactional row for the open season (orders, packages, prints,
          routes, shipments, drafts, notifications) and resets counters and reservations. It never
          touches the catalog, customers, staff, settings, or the audit log. Every action is audited.
        </p>
        <TestConsoleClient />
      </Card>
    </div>
  );
}
