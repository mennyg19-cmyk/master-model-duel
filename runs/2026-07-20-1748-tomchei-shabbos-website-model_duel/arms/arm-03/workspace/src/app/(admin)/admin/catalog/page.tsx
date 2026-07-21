import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { CatalogAdmin } from "@/components/admin/catalog-admin";
import { AddOnAdmin } from "@/components/admin/addon-admin";

export default async function AdminCatalogPage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-8">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Product catalog
          </h1>
          <p className="mt-1 text-sm text-[var(--color-ink)]/70">
            CRUD with season select and replacement-link editor shell.
          </p>
        </div>
        <CatalogAdmin />
        <AddOnAdmin />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
