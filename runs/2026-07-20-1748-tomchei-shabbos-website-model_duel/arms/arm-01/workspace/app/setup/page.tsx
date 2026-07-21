import { db } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { SetupForm } from "@/components/setup-form";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const staffCount = await db.staffUser.count();

  return (
    <main className="flex-1 flex items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardTitle>First-time setup</CardTitle>
        {staffCount > 0 ? (
          <p className="text-sm text-muted">
            Setup is locked: staff accounts already exist. Sign in at{" "}
            <a href="/login" className="text-brand hover:underline">/login</a> instead.
          </p>
        ) : (
          <SetupForm />
        )}
      </Card>
    </main>
  );
}
