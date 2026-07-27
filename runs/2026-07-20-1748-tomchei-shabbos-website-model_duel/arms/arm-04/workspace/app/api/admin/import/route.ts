import { z } from "zod";
import { requirePermissionApi } from "@/lib/auth/current-user";
import { writeAudit } from "@/lib/audit";
import { getOpenSeason } from "@/lib/season";
import { stageImport, commitImport, type ImportKind } from "@/lib/imports";
import type { Permission } from "@/lib/auth/permissions";

const requestSchema = z.object({
  kind: z.enum(["customers", "products"]),
  mode: z.enum(["preview", "commit"]),
  csv: z.string().min(1).max(2_000_000),
});

const PERMISSION_FOR: Record<ImportKind, Permission> = {
  customers: "customers.manage",
  products: "catalog.manage",
};

/** Staged CSV import (R-063, R-143): preview marks every row; commit is atomic + audited. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0].message }, { status: 400 });

  const gate = await requirePermissionApi(PERMISSION_FOR[parsed.data.kind]);
  if ("response" in gate) return gate.response;

  const season = await getOpenSeason();
  if (parsed.data.kind === "products" && !season) {
    return Response.json({ error: "Product imports need an open season" }, { status: 409 });
  }
  const seasonId = season?.id ?? "";

  if (parsed.data.mode === "preview") {
    const staged = await stageImport(parsed.data.kind, parsed.data.csv, seasonId);
    if (!staged.ok) return Response.json({ error: staged.error }, { status: 400 });
    return Response.json(staged);
  }

  const result = await commitImport(parsed.data.kind, parsed.data.csv, seasonId);
  if (!result.ok) {
    return Response.json({ error: result.error, invalidLines: result.invalidLines ?? [] }, { status: 409 });
  }
  await writeAudit(gate.staff, {
    action: "import.commit",
    targetType: "Import",
    detail: { kind: parsed.data.kind, created: result.created, skippedDuplicates: result.skippedDuplicates },
  });
  return Response.json(result);
}
