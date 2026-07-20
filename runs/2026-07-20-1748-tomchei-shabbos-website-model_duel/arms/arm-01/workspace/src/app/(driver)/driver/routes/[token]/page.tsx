import { DriverRoute } from "@/components/driver-route";

export default async function DriverRoutePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="min-h-screen bg-[var(--surface)] px-4 py-8">
      <DriverRoute token={token} />
    </main>
  );
}
