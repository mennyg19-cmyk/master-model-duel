import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createRequestId } from "@/lib/ids";

const maximumBodyBytes = 2_048;

function tokenMatches(supplied: string | null, expected: string) {
  if (!supplied) return false;
  const suppliedDigest = createHash("sha256").update(supplied).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(suppliedDigest, expectedDigest);
}

async function readBoundedBody(request: Request) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export async function POST(request: Request) {
  const expectedToken = process.env.CLIENT_ERROR_TOKEN;
  const authorization = request.headers.get("authorization");
  const suppliedToken = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : request.headers.get("x-client-error-token");
  if (!expectedToken) {
    return NextResponse.json(
      { error: "Client error ingestion is not configured." },
      { status: 503 },
    );
  }
  if (!tokenMatches(suppliedToken, expectedToken)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    return NextResponse.json(
      { error: "Client error report exceeds 2 KB." },
      { status: 413 },
    );
  }
  let body: {
    route?: string;
    category?: string;
  };
  try {
    body = JSON.parse(rawBody) as typeof body;
  } catch {
    return NextResponse.json({ error: "Client error report is invalid." }, { status: 400 });
  }
  const report = {
    requestId: createRequestId(),
    route: body.route?.slice(0, 200) ?? "unknown",
    category: body.category?.slice(0, 80) ?? "unknown",
  };
  console.error("client_error", report);
  return NextResponse.json({ requestId: report.requestId }, { status: 202 });
}
