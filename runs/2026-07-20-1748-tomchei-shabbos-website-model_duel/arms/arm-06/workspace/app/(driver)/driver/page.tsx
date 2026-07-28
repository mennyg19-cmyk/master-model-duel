import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";
import { hasPermission } from "@/lib/permissions";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Driver portal" };
export const dynamic = "force-dynamic";

export default async function DriverPage() {
  const ctx = await requireStaff();
  const canSeeAdmin = hasPermission(ctx.staff, "admin.access");

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md p-8">
        <CardTitle>Driver portal</CardTitle>
        <p className="mt-4 text-sm text-stone-600">
          Signed in as <strong>{ctx.staff.name}</strong> ({ctx.staff.role}).
        </p>
        <p className="mt-2 text-sm text-stone-600">
          Magic-link delivery routes arrive in a later phase. This placeholder proves the
          driver route group and session gate work.
        </p>
        {canSeeAdmin && (
          <p className="mt-4 text-sm">
            <a href="/admin" className="text-brand-700 hover:underline">
              Go to admin
            </a>
          </p>
        )}
      </Card>
    </main>
  );
}
