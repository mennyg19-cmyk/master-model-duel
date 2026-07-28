import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold text-stone-900">Page not found</h1>
        <p className="mt-2 text-stone-600">That page does not exist.</p>
        <Link href="/" className="mt-4 inline-block text-brand-700 hover:underline">
          Back to home
        </Link>
      </div>
    </main>
  );
}
