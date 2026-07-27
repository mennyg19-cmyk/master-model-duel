import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { normalizeEmail } from "@/lib/foundation";
import { getAvailableQuantity } from "@/lib/inventory";
import { authenticate } from "@/lib/route-auth";

const recipientSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("self"), addressId: z.string().cuid().optional() }),
  z.object({ kind: z.literal("saved"), addressId: z.string().cuid() }),
  z.object({
    kind: z.literal("new"),
    recipientName: z.string().trim().min(2).max(120),
    line1: z.string().trim().min(3).max(120),
    line2: z.string().trim().max(120).optional(),
    city: z.string().trim().min(2).max(80),
    state: z.string().trim().length(2),
    postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
    label: z.string().trim().max(80).optional(),
  }),
]);

export const addressSchema = z.object({
  recipientName: z.string().trim().min(2).max(120),
  line1: z.string().trim().min(3).max(120),
  line2: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().min(2).max(80),
  state: z.string().trim().length(2),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
  label: z.string().trim().max(80).nullable().optional(),
});

export const draftSchema = z.object({
  lines: z.array(z.object({
    productId: z.string().cuid(),
    quantity: z.number().int().min(1).max(100),
    productOptionId: z.string().cuid().optional(),
    addOns: z.array(z.object({
      productAddOnId: z.string().cuid(),
      quantity: z.number().int().min(1).max(20),
    })).max(10).default([]),
    recipient: recipientSchema,
  })).min(1).max(100),
});

type DraftInput = z.infer<typeof draftSchema>;

type CustomerContext = {
  customerId: string;
  clerkUserId?: string;
};

type DraftRecord = Prisma.OrderGetPayload<{
  include: {
    customer: { include: { addresses: true } };
    lines: { include: { addOns: true } };
    season: true;
  };
}>;

function tokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function addressKey(address: {
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
  postalCode: string;
}) {
  return [address.line1, address.line2, address.city, address.state, address.postalCode, "US"]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toLowerCase().replace(/\s+/g, " "))
    .join("|");
}

function coordinatesForPostalCode(postalCode: string) {
  const coordinates: Record<string, [number, number]> = {
    "11201": [40.6953, -73.9893],
    "11205": [40.6947, -73.9663],
    "11211": [40.7128, -73.9582],
  };
  return coordinates[postalCode.slice(0, 5)] ?? null;
}

export function makeGuestAccessToken() {
  return randomBytes(32).toString("base64url");
}

export async function findCustomerForRequest(request: Request): Promise<CustomerContext | null> {
  const authentication = await authenticate(request, true);
  if (!authentication.ok) return null;
  const existingIdentity = await prisma.customerIdentity.findUnique({
    where: { clerkUserId: authentication.userId },
  });
  if (existingIdentity?.customerId) {
    return { customerId: existingIdentity.customerId, clerkUserId: authentication.userId };
  }

  const email = authentication.email ? normalizeEmail(authentication.email) : null;
  const existingCustomer = email && authentication.emailVerified
    ? await prisma.customer.findUnique({ where: { emailNormalized: email } })
    : null;
  const displayName = email?.split("@")[0] || "Customer";
  const customer = existingCustomer ?? await prisma.customer.create({
    data: {
      firstName: displayName.slice(0, 80),
      lastName: "",
      emailNormalized: existingCustomer ? null : email,
    },
  });
  await prisma.customerIdentity.upsert({
    where: { clerkUserId: authentication.userId },
    create: { clerkUserId: authentication.userId, email: email ?? `${authentication.userId}@identity.local`, customerId: customer.id },
    update: { email: email ?? `${authentication.userId}@identity.local`, customerId: customer.id },
  });
  if (existingCustomer) {
    await prisma.auditEvent.create({
      data: {
        action: "customer.identity_linked",
        subjectId: customer.id,
        details: { clerkUserId: authentication.userId },
      },
    });
  }
  return { customerId: customer.id, clerkUserId: authentication.userId };
}

async function createGuestCustomer() {
  return prisma.customer.create({
    data: { firstName: "Guest", lastName: "Checkout" },
  });
}

export async function createDraft(request: Request) {
  const customer = await findCustomerForRequest(request);
  const season = await prisma.season.findFirst({ where: { status: "OPEN" }, orderBy: { year: "desc" } });
  if (!season) throw new Error("Ordering is unavailable because there is no open season.");
  const guestToken = customer ? null : makeGuestAccessToken();
  const guestCustomer = customer ? null : await createGuestCustomer();
  const draft = await prisma.order.create({
    data: {
      seasonId: season.id,
      customerId: customer?.customerId ?? guestCustomer!.id,
      draftReference: `DRAFT-${randomBytes(9).toString("hex").toUpperCase()}`,
      guestAccessTokenHash: guestToken ? tokenHash(guestToken) : null,
      guestAccessExpiresAt: guestToken ? new Date(Date.now() + 1000 * 60 * 60 * 24 * 30) : null,
      wireFormat: { version: 2, lines: [] },
    },
  });
  return { draft, guestToken };
}

export async function readDraft(request: Request, draftId: string): Promise<DraftRecord | null> {
  const customer = await findCustomerForRequest(request);
  const guestToken = request.headers.get("x-draft-access-token");
  const accessConditions = [
    ...(customer ? [{ customerId: customer.customerId }] : []),
    ...(guestToken ? [{ guestAccessTokenHash: tokenHash(guestToken), guestAccessExpiresAt: { gt: new Date() } }] : []),
  ];
  if (accessConditions.length === 0) return null;
  const draft = await prisma.order.findFirst({
    where: {
      id: draftId,
      status: "DRAFT",
      OR: accessConditions,
    },
    include: {
      customer: { include: { addresses: { orderBy: { id: "desc" } } } },
      lines: { include: { addOns: true } },
      season: true,
    },
  });
  return draft;
}

async function resolveRecipient(
  customerId: string,
  recipient: DraftInput["lines"][number]["recipient"],
) {
  if (recipient.kind === "new") {
    const normalizedAddress = addressKey(recipient);
    const coordinates = coordinatesForPostalCode(recipient.postalCode);
    if (coordinates) {
      await prisma.geocodeCache.upsert({
        where: { normalizedAddress },
        create: {
          normalizedAddress,
          latitude: new Prisma.Decimal(coordinates[0]),
          longitude: new Prisma.Decimal(coordinates[1]),
          provider: "postal-centroid",
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
        },
        update: { expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90) },
      });
    }
    return prisma.address.upsert({
      where: { customerId_normalizedAddress: { customerId, normalizedAddress } },
      create: {
        customerId,
        label: recipient.label,
        recipientName: recipient.recipientName,
        line1: recipient.line1,
        line2: recipient.line2,
        city: recipient.city,
        state: recipient.state.toUpperCase(),
        postalCode: recipient.postalCode,
        normalizedAddress,
        latitude: coordinates ? new Prisma.Decimal(coordinates[0]) : null,
        longitude: coordinates ? new Prisma.Decimal(coordinates[1]) : null,
        geocodedAt: coordinates ? new Date() : null,
      },
      update: {
        label: recipient.label,
        recipientName: recipient.recipientName,
        line1: recipient.line1,
        line2: recipient.line2,
        city: recipient.city,
        state: recipient.state.toUpperCase(),
        postalCode: recipient.postalCode,
      },
    });
  }

  const address = recipient.addressId
    ? await prisma.address.findFirst({ where: { id: recipient.addressId, customerId } })
    : await prisma.address.findFirst({ where: { customerId }, orderBy: { id: "desc" } });
  if (!address) throw new Error("Choose a saved address or add a new recipient.");
  return address;
}

export async function saveDraft(request: Request, draftId: string, input: DraftInput) {
  const draft = await readDraft(request, draftId);
  if (!draft) throw new Error("This draft was not found or you do not have access to it.");
  const products = await prisma.product.findMany({
    where: { id: { in: input.lines.map((line) => line.productId) }, seasonId: draft.seasonId, isActive: true },
    include: {
      options: { where: { isActive: true } },
      restrictedAddons: { include: { addOnProduct: { include: { inventoryItems: true } } } },
      inventoryItems: true,
    },
  });
  if (products.length !== new Set(input.lines.map((line) => line.productId)).size) {
    throw new Error("One or more selected products are no longer available.");
  }

  const savedLines = await Promise.all(input.lines.map(async (line) => {
    const product = products.find((candidate) => candidate.id === line.productId)!;
    if (getAvailableQuantity(product.inventoryItems) < line.quantity) {
      throw new Error(`${product.name} no longer has enough stock.`);
    }
    const option = line.productOptionId
      ? product.options.find((candidate) => candidate.id === line.productOptionId)
      : null;
    if (line.productOptionId && !option) throw new Error(`That option is no longer available for ${product.name}.`);
    const addOns = line.addOns.map((selection) => {
      const allowed = product.restrictedAddons.find((candidate) => candidate.id === selection.productAddOnId);
      if (!allowed || !allowed.addOnProduct.isActive) throw new Error(`That add-on is not available for ${product.name}.`);
      if (getAvailableQuantity(allowed.addOnProduct.inventoryItems) < selection.quantity * line.quantity) {
        throw new Error(`${allowed.addOnProduct.name} no longer has enough stock.`);
      }
      return { selection, allowed };
    });
    const address = await resolveRecipient(draft.customerId!, line.recipient);
    const unitPriceCents = product.priceCents + (option?.priceAdjustmentCents ?? 0);
    return {
      address,
      product,
      option,
      addOns,
      line,
      unitPriceCents,
      lineTotalCents: unitPriceCents * line.quantity
        + addOns.reduce((total, addOn) => total + addOn.allowed.addOnProduct.priceCents * addOn.selection.quantity * line.quantity, 0),
    };
  }));

  const subtotalCents = savedLines.reduce((total, line) => total + line.lineTotalCents, 0);
  await prisma.$transaction(async (transaction) => {
    await transaction.orderLine.deleteMany({ where: { orderId: draftId } });
    await transaction.order.update({
      where: { id: draftId },
      data: {
        subtotalCents,
        totalCents: subtotalCents,
        wireFormat: {
          version: 2,
          lines: savedLines.map((savedLine) => ({
            productId: savedLine.product.id,
            quantity: savedLine.line.quantity,
            productOptionId: savedLine.option?.id,
            addOns: savedLine.addOns.map(({ selection }) => selection),
            recipient: { kind: savedLine.line.recipient.kind, addressId: savedLine.address.id },
          })),
        },
        lines: {
          create: savedLines.map((savedLine) => ({
            productId: savedLine.product.id,
            productOptionId: savedLine.option?.id,
            quantity: savedLine.line.quantity,
            productNameSnapshot: savedLine.product.name,
            skuSnapshot: savedLine.product.sku,
            unitPriceCents: savedLine.unitPriceCents,
            optionSnapshot: savedLine.option ? {
              name: savedLine.option.name,
              value: savedLine.option.value,
              priceAdjustmentCents: savedLine.option.priceAdjustmentCents,
            } : Prisma.JsonNull,
            addOns: {
              create: savedLine.addOns.map(({ selection, allowed }) => ({
                productAddOnId: allowed.id,
                quantity: selection.quantity,
                nameSnapshot: allowed.addOnProduct.name,
                unitPriceCents: allowed.addOnProduct.priceCents,
              })),
            },
          })),
        },
      },
    });
  });
  const savedDraft = await readDraft(request, draftId);
  if (!savedDraft) throw new Error("Draft access expired before it could be saved.");
  return savedDraft;
}

export async function getAccount(request: Request) {
  const customer = await findCustomerForRequest(request);
  if (!customer) return null;
  return prisma.customer.findUnique({
    where: { id: customer.customerId },
    include: {
      addresses: { orderBy: { id: "desc" } },
      orders: {
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          draftReference: true,
          status: true,
          totalCents: true,
          updatedAt: true,
          lines: { select: { quantity: true } },
        },
      },
    },
  });
}

export async function updateCustomerAddress(
  customerId: string,
  addressId: string,
  addressInput: z.infer<typeof addressSchema>,
  staffActorId?: string,
) {
  const normalizedAddress = addressKey(addressInput);
  const coordinates = coordinatesForPostalCode(addressInput.postalCode);
  const existingAddress = await prisma.address.findFirst({ where: { id: addressId, customerId } });
  if (!existingAddress) throw new Error("Address not found.");
  const conflictingAddress = await prisma.address.findFirst({
    where: { customerId, normalizedAddress, NOT: { id: addressId } },
  });
  if (conflictingAddress) throw new Error("Another saved address already uses these details.");
  const address = await prisma.address.update({
    where: { id: existingAddress.id },
    data: {
      ...addressInput,
      state: addressInput.state.toUpperCase(),
      normalizedAddress,
      latitude: coordinates ? new Prisma.Decimal(coordinates[0]) : null,
      longitude: coordinates ? new Prisma.Decimal(coordinates[1]) : null,
      geocodedAt: coordinates ? new Date() : null,
    },
  });
  if (staffActorId) {
    await prisma.auditEvent.create({
      data: {
        actorId: staffActorId,
        action: "customer.address_updated",
        subjectId: address.id,
        details: { customerId, normalizedAddress },
      },
    });
  }
  return address;
}

function customerWireFormat(wireFormat: Prisma.JsonValue) {
  if (!wireFormat || typeof wireFormat !== "object" || Array.isArray(wireFormat)) return wireFormat;
  const { checkout, ...rest } = wireFormat as Record<string, unknown>;
  if (!checkout || typeof checkout !== "object" || Array.isArray(checkout)) return rest;
  const { shippingQuotes: _shippingQuotes, ...customerCheckout } = checkout as Record<string, unknown>;
  return { ...rest, checkout: customerCheckout };
}

export function serializeDraft(draft: DraftRecord | null) {
  if (!draft) return null;
  return {
    id: draft.id,
    draftReference: draft.draftReference,
    subtotalCents: draft.subtotalCents,
    totalCents: draft.totalCents,
    wireFormat: customerWireFormat(draft.wireFormat),
    addresses: draft.customer?.addresses ?? [],
    lines: draft.lines,
  };
}
