import Link from 'next/link';

export default function Unauthorized() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16" data-testid="unauthorized-page">
      <p className="text-sm font-medium text-[var(--color-warning)]">401 — Sign in required</p>
      <h1 className="mt-2 text-2xl font-semibold">Staff sign in required</h1>
      <p className="mt-2 text-[var(--color-ink-muted)]">
        This area is for staff accounts. Sign in with the address a manager invited.
      </p>
      <Link href="/sign-in" className="mt-6 inline-block text-[var(--color-brand)] underline">
        Go to staff sign in
      </Link>
    </div>
  );
}
