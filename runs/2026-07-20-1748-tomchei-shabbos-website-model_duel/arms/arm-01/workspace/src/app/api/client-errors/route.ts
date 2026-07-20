import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/ids";

const maximumBodyBytes = 2_048;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > maximumBodyBytes) {
    return NextResponse.json(
      { error: "Client error report exceeds 2 KB." },
      { status: 413 },
    );
  }

  const body = (await request.json()) as {
    route?: string;
    category?: string;
  };
  const report = {
    requestId: createRequestId(),
    route: body.route?.slice(0, 200) ?? "unknown",
    category: body.category?.slice(0, 80) ?? "unknown",
  };
  console.error("client_error", report);
  return NextResponse.json({ requestId: report.requestId }, { status: 202 });
}
