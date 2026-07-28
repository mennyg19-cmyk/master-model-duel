import { NextResponse } from "next/server";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { parseBody } from "@/lib/parse-body";
import { requireApiCustomer } from "@/lib/customers/session";
import { addressInputSchema, addressSummary, deleteAddress, updateAddress } from "@/lib/customers/addresses";

// R-029/R-042: customer edits/deletes their OWN saved address. Ownership is
// enforced inside the engine functions (customerId match); a foreign id is a
// 404 so book entries can't be enumerated across customers.
function notFoundResponse(error: unknown) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: "Address not found" }, { status: 404 });
  }
  if (error instanceof DomainRuleError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  return null;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;

  const parsed = await parseBody(request, addressInputSchema, "Address is invalid");
  if (!parsed.ok) return parsed.response;

  const { id } = await params;
  try {
    const address = await updateAddress(gate.ctx.customer.id, id, parsed.data);
    return NextResponse.json({ ok: true, address: { ...address, summary: addressSummary(address) } });
  } catch (error) {
    const response = notFoundResponse(error);
    if (response) return response;
    throw error;
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await requireApiCustomer();
  if (!gate.ok) return gate.response;

  const { id } = await params;
  try {
    await deleteAddress(gate.ctx.customer.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const response = notFoundResponse(error);
    if (response) return response;
    throw error;
  }
}
