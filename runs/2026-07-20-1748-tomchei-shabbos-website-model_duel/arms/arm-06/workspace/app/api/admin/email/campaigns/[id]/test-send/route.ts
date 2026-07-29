import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { testSendCampaign } from "@/lib/email/campaigns";

export const dynamic = "force-dynamic";

const testSchema = z.object({ toAddress: z.string().email() });

// R-083: test-send a campaign draft to one address through the outbox + one
// immediate dispatch attempt — the same delivery path a real send takes.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiPermission("customers.manage");
  if (!gate.ok) return gate.response;

  const { id } = await params;
  const parsed = await parseBody(request, testSchema, "An email address is required");
  if (!parsed.ok) return parsed.response;

  try {
    const result = await testSendCampaign(id, parsed.data.toAddress);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
