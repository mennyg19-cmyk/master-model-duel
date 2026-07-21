import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { SeasonsAdmin } from "@/components/admin/seasons-admin";

export default async function SeasonsPage() {
  try {
    await requireAdminPage("settings.write");
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Seasons
        </h1>
        <p className="text-sm opacity-70">
          New-season wizard, Open/Closed gate, and scheduled auto-flip (UR-008, R-097).
        </p>
        <SeasonsAdmin />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
