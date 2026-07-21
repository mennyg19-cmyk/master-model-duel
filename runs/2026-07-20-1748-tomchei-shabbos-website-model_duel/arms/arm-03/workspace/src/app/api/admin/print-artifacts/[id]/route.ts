import { NextResponse } from "next/server";

/**
 * @deprecated Orphaned artifact route for the dead print engine.
 * Live downloads: GET /api/admin/print-batches/artifacts/:artifactId
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Deprecated. Use GET /api/admin/print-batches/artifacts/:artifactId (ops engine).",
      deprecated: true,
    },
    { status: 410 },
  );
}
