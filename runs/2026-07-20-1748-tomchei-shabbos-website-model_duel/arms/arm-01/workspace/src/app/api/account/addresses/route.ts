import { NextResponse } from "next/server";
import {
  type AddressInput,
  validateAddress,
} from "@/domain/customer-address";
import {
  findAccessibleDraft,
  getAuthenticatedCustomer,
} from "@/lib/customer-access";
import { db } from "@/lib/db";

async function resolveCustomerId(request: Request, draftId?: string) {
  const account = await getAuthenticatedCustomer();
  if (account?.customerId) return account.customerId;
  if (!draftId) return null;
  return (await findAccessibleDraft(request, draftId))?.customerId ?? null;
}

export async function GET(request: Request) {
  const searchParams = new URL(request.url).searchParams;
  const customerId = await resolveCustomerId(request, searchParams.get("draftId") ?? undefined);
  if (!customerId) {
    return NextResponse.json({ error: "Address book not found." }, { status: 404 });
  }
  const addresses = await db.customerAddress.findMany({
    where: { customerId },
    orderBy: [{ label: "asc" }, { recipientName: "asc" }],
  });
  return NextResponse.json({ addresses });
}

export async function POST(request: Request) {
  const body = (await request.json()) as AddressInput & { draftId?: string };
  const customerId = await resolveCustomerId(request, body.draftId);
  if (!customerId) {
    return NextResponse.json({ error: "Address book not found." }, { status: 404 });
  }
  try {
    const address = validateAddress(body);
    const savedAddress = await db.customerAddress.upsert({
      where: {
        customerId_normalizedKey: {
          customerId,
          normalizedKey: address.normalizedKey,
        },
      },
      update: {
        label: address.label,
        recipientName: address.recipientName,
        line1: address.line1,
        line2: address.line2,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        countryCode: address.countryCode,
        geocodedAt: address.geocodedAt,
        geocodeProvider: address.geocodeProvider,
        version: { increment: 1 },
      },
      create: { customerId, ...address },
    });
    return NextResponse.json({ address: savedAddress }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Address could not be saved." },
      { status: 400 },
    );
  }
}
