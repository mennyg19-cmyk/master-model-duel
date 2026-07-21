import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { ImportsClient } from "@/components/admin/imports-client";

export default async function ImportsPage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          CSV imports
        </h1>
        <p className="text-sm opacity-70">
          Stage customers or products, preview valid/duplicate/invalid rows, then atomically commit.
        </p>
        <ImportsClient />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
