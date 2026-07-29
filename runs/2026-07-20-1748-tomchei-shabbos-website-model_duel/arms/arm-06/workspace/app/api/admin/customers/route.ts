import { NextResponse } from "next/server";
import { z } from "zod";
import { requireApiPermission } from "@/lib/auth";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/parse-body";
import { mapDomainError } from "@/lib/http-errors";
import { searchCustomers } from "@/lib/customers/directory";
import { findOrCreateCustomer } from "@/lib/customers/dedupe";

export const dynamic = "force-dynamic";

// R-060: POS customer lookup — staff taking payment may search the directory;
// full management stays behind customers.manage. Bounded: top 10 matches.
export async function GET(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const q = new URL(request.url).searchParams.get("q") ?? "";
  const customers = await searchCustomers(q);
  return NextResponse.json({ customers });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).nullish(),
});

// POS find-or-create: an existing email/phone attaches (R-144) and reports
// created=false, so a returning counter customer never forks a duplicate row.
export async function POST(request: Request) {
  const gate = await requireApiPermission("payments.manage");
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, createSchema, "Customer fields are missing or invalid");
  if (!parsed.ok) return parsed.response;

  try {
    const { customer, created } = await findOrCreateCustomer(parsed.data);
    // Audit only genuine creates — an attach is the dedupe rule, not a write.
    if (created) {
      await recordAudit({
        ctx: gate.ctx,
        action: "customer_create",
        targetType: "Customer",
        targetId: customer.id,
        metadata: { email: customer.email, channel: "pos" },
      });
    }
    return NextResponse.json(
      { customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone }, created },
      { status: created ? 201 : 200 },
    );
  } catch (error) {
    const mapped = mapDomainError(error);
    if (mapped) return mapped;
    throw error;
  }
}
