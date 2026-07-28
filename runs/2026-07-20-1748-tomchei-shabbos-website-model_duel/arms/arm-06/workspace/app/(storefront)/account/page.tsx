import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Account" };

// Customer accounts arrive with ordering (P4); the user menu points here so
// the link is never dead.
export default function AccountPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-2xl font-bold text-stone-900">Your account</h1>
      <p className="mt-4 text-stone-600">
        Customer sign-in arrives with online ordering. Until then, browse the{" "}
        <Link href="/packages" className="font-medium text-brand-700 underline">
          current packages
        </Link>{" "}
        or join the mailing list below for season updates.
      </p>
    </main>
  );
}
