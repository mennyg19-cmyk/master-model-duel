import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { EmailHub } from "@/components/admin/email-hub";

export default async function AdminEmailPage() {
  try {
    await requireAdminPage("settings.read");
    return (
      <main className="space-y-4" data-testid="admin-email-hub">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Email hub
          </h1>
          <p className="mt-1 text-sm opacity-80">
            Campaigns, subscribers, lists, templates, and triggered mail.
          </p>
        </header>
        <EmailHub />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
