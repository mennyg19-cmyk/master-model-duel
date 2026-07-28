import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { SetupForm } from "./setup-form";

export const metadata: Metadata = { title: "First-run setup" };
export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const staffCount = await prisma.staffUser.count();
  const isLocked = staffCount > 0;

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md p-8">
        <CardTitle>First-run setup</CardTitle>
        {isLocked ? (
          <p className="mt-4 text-sm text-stone-600">
            Setup is locked. A staff account already exists, so the bootstrap endpoint no
            longer creates managers. Sign in instead.
          </p>
        ) : (
          <>
            <p className="mt-4 text-sm text-stone-600">
              No staff accounts exist yet. The first account created here becomes the
              manager, then setup locks itself.
            </p>
            <SetupForm />
          </>
        )}
      </Card>
    </main>
  );
}
