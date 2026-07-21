"use client";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-4">
      <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
        Something went wrong
      </h1>
      <p className="text-sm opacity-80">
        {process.env.NODE_ENV === "production"
          ? "Please try again. If it keeps happening, contact staff."
          : error.message}
      </p>
      <button
        type="button"
        className="rounded-[var(--radius-md)] bg-[var(--color-leaf)] px-3 py-2 text-sm font-semibold text-white"
        onClick={reset}
      >
        Try again
      </button>
    </main>
  );
}
