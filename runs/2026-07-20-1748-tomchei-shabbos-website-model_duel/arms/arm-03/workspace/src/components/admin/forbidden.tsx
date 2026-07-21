export function Forbidden({ message }: { message: string }) {
  return (
    <main className="rounded-[var(--radius-lg)] bg-white p-8 shadow-sm">
      <h1 className="text-2xl font-semibold text-[var(--color-danger)]">403 Forbidden</h1>
      <p className="mt-2 text-sm">{message}</p>
    </main>
  );
}
