import { StaffManager } from "@/components/admin/staff-manager";
import { AuthError } from "@/lib/auth";
import { Forbidden } from "@/components/admin/forbidden";
import { requireAdminPage } from "@/lib/admin-gate";
import { db } from "@/lib/db";

export default async function StaffPage() {
  try {
    await requireAdminPage("staff.manage");
    const staff = await db.staffUser.findMany({
      include: { permissionOverrides: true },
      orderBy: { createdAt: "asc" },
    });
    return (
      <main className="space-y-4">
        <h1 className="font-[family-name:var(--font-display)] text-3xl text-[var(--color-forest)]">
          Staff management
        </h1>
        <StaffManager
          initialStaff={staff.map((row) => ({
            ...row,
            revokedAt: row.revokedAt?.toISOString() ?? null,
          }))}
        />
      </main>
    );
  } catch (error) {
    if (error instanceof AuthError && error.status === 403) {
      return <Forbidden message={error.message} />;
    }
    throw error;
  }
}
