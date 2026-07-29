import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { parseBody } from "@/lib/parse-body";
import { getEmailBranding, brandTokens, renderTemplate } from "@/lib/email/render";
import { dispatchOnce } from "@/lib/email/claim-deliver";
import { TEST_OUTBOX_KINDS } from "@/lib/notify/outbox";
import { prisma } from "@/lib/db";
import { mapDomainError } from "@/lib/http-errors";

// R-180: "send a test email" from the Email settings card — goes through the
// outbox like any other send, then one claimed inline dispatch. The claim
// keeps the sweeper from racing the inline attempt into a double delivery;
// if the sweeper won the claim anyway, the row is reported honestly.
export const dynamic = "force-dynamic";

const testSchema = z.object({ toAddress: z.string().email() });

export async function POST(request: Request) {
  const gate = await requireApiPermission("settings.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, testSchema, "toAddress must be a valid email address");
  if (!parsed.ok) return parsed.response;

  try {
    const branding = await getEmailBranding();
    const tokens = brandTokens(branding, { customerName: "Test Recipient" });
    const row = await prisma.outboxMessage.create({
      data: {
        kind: TEST_OUTBOX_KINDS[1],
        channel: "EMAIL",
        toAddress: parsed.data.toAddress,
        subject: `[test] ${branding.fromName} settings check`,
        body: renderTemplate(
          "This is a test email from the {brand} admin settings. If you can read this, outbound email works.\n\n{footer}",
          tokens,
        ),
      },
    });
    const result = await dispatchOnce(row.id, branding);
    return NextResponse.json(result);
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
