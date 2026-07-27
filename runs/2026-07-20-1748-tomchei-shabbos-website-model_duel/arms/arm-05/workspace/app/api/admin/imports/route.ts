import { NextResponse } from "next/server";
import { z } from "zod";
import { commitImport, getStagedImportKind, stageImport } from "@/lib/admin-operations";
import { authorize, hasSameOrigin } from "@/lib/route-auth";
import { hasStaffPermission } from "@/lib/staff-store";

const importSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("stage"), kind: z.enum(["customers", "products"]), csv: z.string().min(1).max(500_000) }),
  z.object({ action: z.literal("commit"), batchId: z.string().uuid() }),
]);

function canWriteImportKind(kind: "customers" | "products", staffMember: Parameters<typeof hasStaffPermission>[0]) {
  return hasStaffPermission(staffMember, kind === "customers" ? "customers.write" : "settings.manage");
}

export async function POST(request: Request) {
  const authorization = await authorize(request, "imports.manage");
  if (!authorization.ok) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  if (!hasSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Provide a valid staged import request." }, { status: 400 });
  try {
    const kind = parsed.data.action === "stage"
      ? parsed.data.kind
      : await getStagedImportKind(parsed.data.batchId);
    if (!canWriteImportKind(kind, authorization.staffMember)) {
      return NextResponse.json({ error: "You do not have permission to write this import." }, { status: 403 });
    }
    const body = parsed.data.action === "stage"
      ? await stageImport(parsed.data.csv, kind, authorization.staffMember.id)
      : await commitImport(parsed.data.batchId, authorization.staffMember.id);
    return NextResponse.json(body);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Import could not be completed." }, { status: 400 });
  }
}
