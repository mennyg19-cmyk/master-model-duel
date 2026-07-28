import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Badge, ROLE_TONES } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Staff" };
export const dynamic = "force-dynamic";

const statusTones = { ACTIVE: "green", PENDING: "amber", REVOKED: "red" } as const;

export default async function StaffListPage() {
  await requirePermission("staff.manage");
  const staffUsers = await prisma.staffUser.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Staff</h1>
        <Link href="/admin/staff/new">
          <Button>Add staff</Button>
        </Link>
      </div>

      <div className="mt-6 overflow-x-auto rounded-lg border border-stone-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-stone-200 bg-stone-50 text-xs uppercase text-stone-500">
            <tr>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Role</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Version</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {staffUsers.map((staff) => (
              <tr key={staff.id} className="border-b border-stone-100 last:border-0">
                <td className="px-4 py-3 font-medium">{staff.name}</td>
                <td className="px-4 py-3 text-stone-600">{staff.email}</td>
                <td className="px-4 py-3">
                  <Badge tone={ROLE_TONES[staff.role]}>{staff.role}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTones[staff.status]}>{staff.status}</Badge>
                </td>
                <td className="px-4 py-3 text-stone-500">{staff.version}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/admin/staff/${staff.id}`} className="text-brand-700 hover:underline">
                    Edit
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
