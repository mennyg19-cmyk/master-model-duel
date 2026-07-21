import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";

export default async function GatedPage() {
  try {
    await requireAdminPage("staff.manage");
    return (
      <main className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--color-forest)]">Gated page</h1>
        <p className="mt-2 text-sm">Visible only with staff.manage permission.</p>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
