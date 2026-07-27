import { db } from "@/lib/db";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { StaffManager } from "@/components/staff-manager";

export default async function StaffPage() {
  const staff = await requirePermissionPage("staff.manage");
  const staffMembers = await db.staffUser.findMany({
    include: { permissionOverrides: true },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-6">Staff management</h1>
      <StaffManager
        currentUserId={staff.realUser.id}
        canImpersonate={staff.actingAs.permissions.has("staff.impersonate")}
        staffMembers={staffMembers.map((member) => ({
          id: member.id,
          name: member.name,
          email: member.email,
          role: member.role,
          status: member.status,
          overrides: member.permissionOverrides.map(({ permission, effect }) => ({
            permission,
            effect,
          })),
        }))}
      />
    </div>
  );
}
