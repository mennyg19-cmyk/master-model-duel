import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { canImpersonate as canImpersonateRole, hasPermission } from "@/lib/permissions";
import { prisma } from "@/lib/db";
import { Card, CardTitle } from "@/components/ui/card";
import { StaffEditor } from "./staff-editor";

export const metadata: Metadata = { title: "Edit staff" };
export const dynamic = "force-dynamic";

export default async function StaffDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("staff.manage");
  const { id } = await params;

  const target = await prisma.staffUser.findUnique({ where: { id }, include: { overrides: true } });
  if (!target) notFound();

  return (
    <div className="max-w-2xl">
      <Card className="p-6">
        <CardTitle>
          {target.name} <span className="text-sm font-normal text-stone-500">{target.email}</span>
        </CardTitle>
        <StaffEditor
          staff={{
            id: target.id,
            email: target.email,
            role: target.role,
            status: target.status,
            version: target.version,
            inviteToken: target.inviteToken,
            overrides: target.overrides.map((entry) => ({
              permission: entry.permission,
              effect: entry.effect,
            })),
          }}
          isSelf={ctx.staff.id === target.id}
          canImpersonate={
            hasPermission(ctx.staff, "staff.impersonate") && canImpersonateRole(ctx.staff.role, target.role)
          }
        />
      </Card>
    </div>
  );
}
