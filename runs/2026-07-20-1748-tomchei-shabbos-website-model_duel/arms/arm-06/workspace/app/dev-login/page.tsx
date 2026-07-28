import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isDevAuthBypass } from "@/lib/env";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { DevLoginForm } from "./dev-login-form";
import { DevCustomerLoginForm } from "./dev-customer-login-form";

export const metadata: Metadata = { title: "Dev sign in" };
export const dynamic = "force-dynamic";

export default async function DevLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (!isDevAuthBypass) notFound();

  const { next } = await searchParams;
  const [staffUsers, customers] = await Promise.all([
    prisma.staffUser.findMany({
      where: { status: "ACTIVE" },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true, role: true },
    }),
    prisma.customer.findMany({
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, email: true },
      take: 20,
    }),
  ]);

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-6 md:flex-row">
        <Card className="w-full p-8">
          <CardTitle>Dev sign in — staff</CardTitle>
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
            <DevLoginForm staffUsers={staffUsers} next={next?.startsWith("/admin") ? next : "/admin"} />
          )}
        </Card>

        <Card className="w-full p-8">
          <CardTitle>Dev sign in — customer</CardTitle>
          <p className="mt-4 text-sm text-stone-600">
            Customer side of the same seam. The customer cookie names a server-side session row,
            exactly like the staff flow.
          </p>
          {customers.length === 0 ? (
            <p className="mt-4 text-sm text-stone-600">
              No customer accounts yet — one is created the first time someone orders.
            </p>
          ) : (
            <DevCustomerLoginForm customers={customers} next={next?.startsWith("/admin") ? "/account" : (next ?? "/account")} />
          )}
        </Card>
      </div>
    </main>
  );
}
