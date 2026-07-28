import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-stone-900">No access (403)</h1>
        <p className="mt-2 text-stone-600">
          Your account does not have the permission this page needs. Ask a manager if you
          think this is wrong.
        </p>
        <Link href="/" className="mt-4 inline-block text-brand-700 hover:underline">
          Back to home
        </Link>
      </div>
    </main>
  );
}
