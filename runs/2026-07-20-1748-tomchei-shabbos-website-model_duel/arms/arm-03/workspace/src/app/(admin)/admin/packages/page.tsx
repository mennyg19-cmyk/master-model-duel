import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { PackageBoardClient } from "@/components/admin/package-board";

export default async function PackagesPage() {
  try {
    await requireAdminPage("admin.access");
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Package board
        </h1>
        <p className="text-sm opacity-70">
          Split, regroup, and advance package stages. Printing never means shipped.
        </p>
        <PackageBoardClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
