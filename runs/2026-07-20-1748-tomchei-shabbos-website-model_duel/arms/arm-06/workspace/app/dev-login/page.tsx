import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDevAuthBypass } from "@/lib/env";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { DevLoginForm } from "./dev-login-form";

export const metadata: Metadata = { title: "Dev sign in" };
export const dynamic = "force-dynamic";

export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isDevAuthBypass) notFound();

  const { next } = await searchParams;
  const staffUsers = await prisma.staffUser.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, email: true, role: true },
  });

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <Card className="w-full max-w-md p-8">
        <CardTitle>Dev sign in</CardTitle>
        <p className="mt-4 text-sm text-stone-600">
          Dev-auth bypass is on (<code>DEV_AUTH_BYPASS=true</code>). This stands in for Clerk
          while no live Clerk keys are available on this host. Every role and permission
          gate still runs against the account you pick.
        </p>
        {staffUsers.length === 0 ? (
          <p className="mt-4 text-sm text-stone-600">
            No active staff accounts yet. Run first-run setup at <code>/setup</code>.
          </p>
        ) : (
          <DevLoginForm staffUsers={staffUsers} next={next ?? "/admin"} />
        )}
      </Card>
    </main>
  );
}
