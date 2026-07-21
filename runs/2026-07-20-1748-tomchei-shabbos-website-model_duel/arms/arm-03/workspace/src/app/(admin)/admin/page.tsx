import Link from "next/link";
import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";

export default async function AdminHomePage() {
  try {
    const ctx = await requireAdminPage("admin.access");
    return (
      <main className="space-y-4 rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Admin dashboard
        </h1>
        <p className="text-sm opacity-80">
          Signed in as {ctx.effectiveStaff.displayName} ({ctx.effectiveStaff.role})
          {ctx.impersonating ? " — impersonation active" : ""}.
        </p>
        <div className="flex flex-wrap gap-3 text-sm">
          <Link className="underline" href="/admin/staff">
            Staff management
          </Link>
          <Link className="underline" href="/admin/audit">
            Audit log
          </Link>
          <Link className="underline" href="/admin/settings">
            Settings
          </Link>
        </div>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    if (error instanceof AuthError && error.status === 401) {
      return (
        <main className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Sign in required</h1>
          <p className="mt-2 text-sm">Use AUTH_MODE=dev session cookie or Clerk sign-in.</p>
          <Link className="mt-4 inline-block underline" href="/admin/setup">
            First-run setup
          </Link>
        </main>
      );
    }
    throw error;
  }
}
