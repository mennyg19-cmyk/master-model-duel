import { NextResponse } from "next/server";
import { z } from "zod";
import { ImportKind } from "@prisma/client";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { getOpenSeason } from "@/lib/seasons/queries";
import { stageImport } from "@/lib/imports/engine";
import { IMPORT_HANDLERS, IMPORT_PERMISSION } from "@/lib/imports/kinds";

export const dynamic = "force-dynamic";

const stageSchema = z.object({
  kind: z.nativeEnum(ImportKind),
  filename: z.string().trim().min(1).max(200),
  csv: z.string().min(1).max(2_000_000),
  dryRun: z.boolean().optional(),
});

// R-063: stage a CSV — parse, validate, mark duplicates, store the verdicts.
// Products rows target the open season captured right now. (The recent-batch
// list has one home: the imports page queries it directly — no GET here.)
export async function POST(request: Request) {
  const parsed = await parseBody(request, stageSchema, "Import body is invalid");
  if (!parsed.ok) return parsed.response;

  const permission = IMPORT_PERMISSION[parsed.data.kind];
  const gate = await requireApiPermission(permission);
  if (!gate.ok) return gate.response;

  try {
    const season = parsed.data.kind === "PRODUCTS" ? await getOpenSeason() : null;
    if (parsed.data.kind === "PRODUCTS" && !season) {
      return NextResponse.json({ error: "No open season — product imports target the open season" }, { status: 409 });
    }
    const batch = await stageImport({
      kind: parsed.data.kind,
      handler: IMPORT_HANDLERS[parsed.data.kind],
      filename: parsed.data.filename,
      csvText: parsed.data.csv,
      extraPayload: season ? { seasonId: season.id } : undefined,
      dryRun: parsed.data.dryRun,
      ctx: gate.ctx,
    });
    return NextResponse.json({ ok: true, batchId: batch.id }, { status: 201 });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
