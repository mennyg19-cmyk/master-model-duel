import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [staffCount, customerCount, auditCount] = await Promise.all([
    prisma.staffUser.count(),
    prisma.customer.count(),
    prisma.auditLog.count(),
  ]);

  const stats = [
    { label: "Staff accounts", value: staffCount },
    { label: "Customers", value: customerCount },
    { label: "Audit events", value: auditCount },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <CardTitle className="text-sm font-medium text-stone-500">{stat.label}</CardTitle>
            <p className="mt-2 text-3xl font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
