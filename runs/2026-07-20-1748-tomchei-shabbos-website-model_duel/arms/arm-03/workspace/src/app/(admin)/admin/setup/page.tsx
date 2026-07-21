import { redirect } from "next/navigation";
import { SetupForm } from "@/components/admin/setup-form";
import { isSetupComplete } from "@/lib/auth";

export default async function SetupPage() {
  if (await isSetupComplete()) {
    return (
      <main className="mx-auto mt-16 max-w-md rounded-[var(--radius-lg)] bg-white p-6 shadow-sm">
        <h1 className="text-2xl font-semibold text-[var(--color-forest)]">Setup locked</h1>
        <p className="mt-2 text-sm">
          A manager already exists. First-run bootstrap cannot run again.
        </p>
      </main>
    );
  }
  return <SetupForm />;
}
