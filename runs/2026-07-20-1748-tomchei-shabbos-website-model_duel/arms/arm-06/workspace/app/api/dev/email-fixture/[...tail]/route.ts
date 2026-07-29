import { NextResponse } from "next/server";
import { isDevAuthBypass } from "@/lib/env";
import { fixtureSendsStore } from "../store";

// The provider-shaped half of the Resend dev double: POST /emails is the one
// call the SDK wrapper makes. Scripted behavior: any recipient address
// containing "+fail" is rejected with a Resend-shaped 422 — the
// failure-injection seam for S3. Successful sends are recorded in the shared
// in-process store (read via GET /api/dev/email-fixture).
export async function POST(request: Request, { params }: { params: Promise<{ tail: string[] }> }): Promise<NextResponse> {
  if (!isDevAuthBypass) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const { tail } = await params;
  const path = `/${tail.join("/")}`.replace(/\/+$/, "");
  if (path !== "/emails") {
    return NextResponse.json({ message: `unknown fixture path ${path}` }, { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
  } | null;
  if (!body?.from || !body.to?.length || !body.subject || typeof body.text !== "string") {
    return NextResponse.json({ message: "Missing required email fields (from, to, subject, text)" }, { status: 422 });
  }
  if (body.to.some((address) => address.includes("+fail"))) {
    return NextResponse.json(
      { message: `Fixture rejected recipient ${body.to.find((address) => address.includes("+fail"))} (+fail marker)` },
      { status: 422 },
    );
  }
  const sends = fixtureSendsStore();
  sends.push({ to: body.to, subject: body.subject, from: body.from, at: new Date().toISOString() });
  return NextResponse.json({ id: `fixture_${sends.length.toString().padStart(6, "0")}` }, { status: 200 });
}
