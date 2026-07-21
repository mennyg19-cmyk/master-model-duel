import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";

export default function ForbiddenPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardTitle>403 — No permission</CardTitle>
        <p className="text-sm text-muted mb-3">
          Your account does not have the permission this page requires. Ask a manager to grant it.
        </p>
        <Link href="/admin" className="text-sm text-brand hover:underline">Back to dashboard</Link>
      </Card>
    </main>
  );
}
