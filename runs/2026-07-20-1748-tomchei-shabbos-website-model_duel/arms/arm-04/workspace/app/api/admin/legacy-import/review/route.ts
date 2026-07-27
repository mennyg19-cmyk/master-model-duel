import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { db } from "@/lib/db";

// Address review queue (UR-014): staff resolve suspect imported addresses,
// optionally after fixing the book entry through the existing customer tools.

const resolveSchema = z.object({ itemId: z.string().min(1) });

export async function PATCH(request: Request) {
  const gate = await requirePermissionApi("imports.legacy");
  if ("response" in gate) return gate.response;

  const parsed = resolveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "itemId is required" }, { status: 400 });

  const updated = await db.addressReviewItem.updateMany({
    where: { id: parsed.data.itemId, status: "open" },
    data: { status: "resolved", resolvedAt: new Date(), resolvedByStaffId: gate.staff.realUser.id },
  });
  if (updated.count === 0) return Response.json({ error: "Item not found or already resolved" }, { status: 404 });

  await writeAudit(gate.staff, {
    action: "legacy_import.review_resolve",
    targetType: "AddressReviewItem",
    targetId: parsed.data.itemId,
  });
  return Response.json({ ok: true });
}
