import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const [staffCount, productCount, mediaCount, subscriberCount, auditCount] = await Promise.all([
    prisma.staffUser.count(),
    prisma.product.count(),
    prisma.mediaAsset.count(),
    prisma.newsletterSubscriber.count({ where: { unsubscribedAt: null } }),
    prisma.auditLog.count(),
  ]);

  const stats = [
    { label: "Staff accounts", value: staffCount },
    { label: "Products", value: productCount },
    { label: "Photos", value: mediaCount },
    { label: "Newsletter subscribers", value: subscriberCount },
    { label: "Audit events", value: auditCount },
  ];

  const destinations = [
    { href: "/admin/products", label: "Products", note: "Catalog, options & pricing" },
    { href: "/admin/addons", label: "Add-ons", note: "Extras allowed per product" },
    { href: "/admin/media", label: "Media", note: "Photo uploads & assignment" },
    { href: "/admin/settings", label: "Settings", note: "Delivery ZIPs, fees, package types" },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="mt-6 grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat) => (
          <Card key={stat.label} className="p-5">
            <CardTitle className="text-sm font-medium text-stone-500">{stat.label}</CardTitle>
            <p className="mt-2 text-3xl font-bold">{stat.value}</p>
          </Card>
        ))}
      </div>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {destinations.map((destination) => (
          <Link key={destination.href} href={destination.href}>
            <Card className="h-full p-5 transition-colors hover:border-brand-300">
              <CardTitle className="text-base">{destination.label}</CardTitle>
              <p className="mt-1 text-sm text-stone-500">{destination.note}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
