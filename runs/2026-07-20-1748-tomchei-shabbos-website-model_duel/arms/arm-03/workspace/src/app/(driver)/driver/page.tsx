import { getStaffContext } from "@/lib/auth";

export default async function DriverPage() {
  const ctx = await getStaffContext();
  return (
    <main className="mx-auto max-w-lg rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Driver portal
      </h1>
      <p className="mt-2 text-sm">
        Hello {ctx?.effectiveStaff.displayName ?? "driver"}. Routes land in later phases.
      </p>
    </main>
  );
}
