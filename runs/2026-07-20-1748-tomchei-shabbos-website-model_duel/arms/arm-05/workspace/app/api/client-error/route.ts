import { NextResponse } from "next/server";
import { z } from "zod";

const reportSchema = z.object({
  message: z.string().max(500).refine((message) => !/[\r\n]/.test(message)),
  path: z.string().startsWith("/").max(300),
});

export async function POST(request: Request) {
  const token = process.env.ERROR_REPORTING_TOKEN;
  if (!token || token === "replace_me" || request.headers.get("x-error-reporting-token") !== token) {
    return NextResponse.json({ error: "Error reporting is not authorized." }, { status: 401 });
  }
  const parsed = reportSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid error report." }, { status: 400 });
  console.error("client_error", { path: parsed.data.path, message: parsed.data.message });
  return NextResponse.json({ accepted: true }, { status: 202 });
}
