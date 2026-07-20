import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";

export default function UnauthorizedPage() {
  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-md text-center">
        <CardTitle>401 — Sign in required</CardTitle>
        <p className="text-sm text-muted mb-3">You need to sign in before opening this page.</p>
        <Link href="/login" className="text-sm text-brand hover:underline">Go to sign in</Link>
      </Card>
    </main>
  );
}
