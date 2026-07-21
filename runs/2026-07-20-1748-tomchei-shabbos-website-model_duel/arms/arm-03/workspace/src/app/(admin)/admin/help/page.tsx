import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";

const TOURS = [
  {
    title: "Season open checklist",
    body: "Confirm catalog, replacements, inventory headroom, and storefront gate before opening.",
  },
  {
    title: "Nightly print batch",
    body: "Run Print → Nightly after packages land. Stages stay NEW until staff mark Printed.",
  },
  {
    title: "Shipping margin",
    body: "Customer is charged the higher quote; we buy the cheaper eligible carrier. Review Reports → Margin.",
  },
  {
    title: "Legacy import",
    body: "Stage with dry-run first, map missing products, then atomic commit. Resume interrupted batches from Imports.",
  },
];

export default async function AdminHelpPage() {
  try {
    await requireAdminPage("admin.access");
    return (
      <main className="space-y-4" data-testid="admin-help">
        <header className="rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
            Help center
          </h1>
          <p className="mt-1 text-sm opacity-80">Guided tours for launch-critical workflows.</p>
        </header>
        <ul className="space-y-3">
          {TOURS.map((tour) => (
            <li key={tour.title} className="rounded bg-white p-4 shadow-sm">
              <p className="font-semibold">{tour.title}</p>
              <p className="mt-1 text-sm opacity-80">{tour.body}</p>
            </li>
          ))}
        </ul>
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
