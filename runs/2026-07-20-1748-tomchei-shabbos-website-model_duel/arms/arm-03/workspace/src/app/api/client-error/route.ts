import { NextResponse } from "next/server";
import { z } from "zod";
import { maskError } from "@/lib/result";

const schema = z.object({
  message: z.string().max(500),
  route: z.string().max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const body = schema.parse(await request.json());
    console.error("[client-error]", {
      message: body.message.slice(0, 200),
      route: body.route,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: maskError(error) },
      { status: 400 },
    );
  }
}
