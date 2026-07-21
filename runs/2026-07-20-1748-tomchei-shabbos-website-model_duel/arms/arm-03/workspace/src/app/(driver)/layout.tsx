import { getStaffContext } from "@/lib/auth";

export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getStaffContext();
  const allowed = ctx?.permissions.has("driver.access");
  return (
    <div data-route-group="driver" className="min-h-screen bg-[var(--color-cream)] px-4 py-8">
      {!allowed ? (
        <main className="mx-auto max-w-lg rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-[var(--color-danger)]">Driver access required</h1>
          <p className="mt-2 text-sm">Sign in with a driver-role staff account.</p>
        </main>
      ) : (
        children
      )}
    </div>
  );
}
