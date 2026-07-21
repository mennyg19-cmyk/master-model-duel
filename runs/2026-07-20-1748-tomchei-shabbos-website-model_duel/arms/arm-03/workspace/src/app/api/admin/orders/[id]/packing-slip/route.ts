import { NextResponse } from "next/server";

/**
 * @deprecated Dead-engine packing slip. Order slips are included in
 * POST /api/admin/print-batches `{ action: "reprint-order" }` (ops engine).
 */
export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Deprecated. Use POST /api/admin/print-batches action=reprint-order (ops engine).",
      deprecated: true,
    },
    { status: 410 },
  );
}
