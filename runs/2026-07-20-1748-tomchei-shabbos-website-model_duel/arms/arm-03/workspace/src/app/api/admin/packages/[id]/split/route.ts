import { NextResponse } from "next/server";

/**
 * @deprecated Duplicate engine route. Live UI uses POST /api/admin/packages/:id
 * with `{ action: "split", itemIds }` backed by `@/lib/ops/packages`.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Deprecated. Use POST /api/admin/packages/:id with action=split (ops engine).",
      deprecated: true,
    },
    { status: 410 },
  );
}
