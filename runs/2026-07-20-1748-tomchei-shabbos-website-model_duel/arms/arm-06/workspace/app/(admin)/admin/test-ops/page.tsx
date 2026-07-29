import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { env } from "@/lib/env";
import { TestOpsConsole } from "@/app/(admin)/admin/test-ops/test-ops-console";

export const metadata: Metadata = { title: "Test console" };
export const dynamic = "force-dynamic";

// R-101/R-014: the test-environment console. On a production deployment the
// page explains it is disabled instead of rendering live buttons — the API
// refuses either way (R-129).
export default async function AdminTestOpsPage() {
  await requirePermission("settings.manage");
  const enabled = env.APP_ENV === "test";

  return (
    <div>
      <h1 className="text-2xl font-semibold">Test console</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-500">
        Seed, clear, wipe, and reset the test database between rehearsal acts. Every action is audited.
        Staff accounts and the audit log always survive.
      </p>
      {enabled ? (
        <TestOpsConsole />
      ) : (
        <p className="mt-5 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800" data-testops-disabled>
          Disabled — this deployment is not the test environment (APP_ENV is not &quot;test&quot;).
        </p>
      )}
    </div>
  );
}
