import { NextResponse } from "next/server";

/**
 * @deprecated Duplicate engine route. Live UI uses POST /api/admin/packages/:id
 * with `{ action: "stage", toStage }` backed by `@/lib/ops/packages` + package-stages.
 */
export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "Deprecated. Use POST /api/admin/packages/:id with action=stage (ops engine).",
      deprecated: true,
    },
    { status: 410 },
  );
}
