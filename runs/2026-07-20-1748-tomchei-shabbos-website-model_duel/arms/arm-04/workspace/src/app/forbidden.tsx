import Link from 'next/link';

export default function Forbidden() {
  return (
    <div className="mx-auto max-w-xl px-4 py-16" data-testid="forbidden-page">
      <p className="text-sm font-medium text-[var(--color-danger)]">403 — Forbidden</p>
      <h1 className="mt-2 text-2xl font-semibold">You do not have permission for this page</h1>
      <p className="mt-2 text-[var(--color-ink-muted)]">
        Your account is signed in, but a manager has not granted you this permission. Ask a manager to
        add it in Staff management.
      </p>
      <Link href="/admin" className="mt-6 inline-block text-[var(--color-brand)] underline">
        Back to the dashboard
      </Link>
    </div>
  );
}
