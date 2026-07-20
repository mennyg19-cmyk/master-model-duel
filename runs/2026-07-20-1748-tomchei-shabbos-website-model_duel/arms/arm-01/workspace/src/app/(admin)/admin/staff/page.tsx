import { requirePermission } from "@/lib/auth";
import { db } from "@/lib/db";
import { StaffManager } from "./staff-manager";

export const dynamic = "force-dynamic";

export default async function StaffPage() {
  await requirePermission("staff:manage");
  const staffUsers = await db.staffUser.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      status: true,
      grantPermissions: true,
      denyPermissions: true,
      version: true,
    },
  });

  return <StaffManager initialStaffUsers={staffUsers} />;
}
