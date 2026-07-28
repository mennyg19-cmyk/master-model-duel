import Link from "next/link";

// R-002: the server-side closure enforcement body shared by /order and
// /checkout. Rendered only when no season is OPEN.
export function ClosedNotice({ attempted }: { attempted: string }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-center">
      <h1 className="text-2xl font-bold text-stone-900">Ordering is closed for this season</h1>
      <p className="mt-4 text-stone-600">
        {attempted} isn&apos;t available while the store is closed. Browse past collections or join
        the mailing list and we&apos;ll let you know when the new season opens.
      </p>
      <Link
        href="/past-collections"
        className="mt-6 inline-block rounded-md bg-brand-700 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
      >
        Browse past collections
      </Link>
    </main>
  );
}
