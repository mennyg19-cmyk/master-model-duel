import { Prisma } from "@prisma/client";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// The engine is the trust boundary (R-149/R-150): callers pass catalog ids +
// quantities ONLY. Names, unit prices, and option deltas are snapshotted here
// from the catalog rows — never from the caller — so a checkout route
// forwarding client input cannot inject prices or spoof products.
export interface DraftLineInput {
  /** Caller-generated line id. REQUIRED on a product line that has add-on
   *  lines, so they can reference it as their parentLineId. */
  id?: string;
  /** Product line: the catalog product. */
  productId?: string;
  /** Product line: chosen ProductOptionValue (must belong to the product). */
  optionValueId?: string;
  /** Add-on line: the catalog add-on (must be allowed on the parent product). */
  addOnId?: string;
  /** Add-on line: the `id` of a product line in this same input. */
  parentLineId?: string;
  qty: number;
  /** P4: caller-generated id of the recipient this line is assigned to
   *  (matches DraftRecipientInput.clientId in the same save call). */
  recipientClientId?: string | null;
}

export interface ResolvedLine {
  id?: string;
  productId: string | null;
  productName: string;
  qty: number;
  unitPriceCents: number;
  optionValueId: string | null;
  optionLabel: string | null;
  optionPriceDeltaCents: number;
  addOnId: string | null;
  parentInputId: string | null;
  recipientClientId: string | null;
  lineTotalCents: number;
}

export async function resolveDraftLines(
  tx: Prisma.TransactionClient,
  inputLines: DraftLineInput[],
  seasonId: string,
): Promise<ResolvedLine[]> {
  if (inputLines.length === 0) {
    throw new DomainRuleError("Order must have at least one line");
  }

  // Batch-load every referenced catalog row; the maps double as existence
  // proof — any id not in its map is fabricated.
  const products = new Map(
    (
      await tx.product.findMany({
        where: { id: { in: inputLines.map((l) => l.productId).filter((id): id is string => !!id) } },
      })
    ).map((p) => [p.id, p]),
  );
  const optionValues = new Map(
    (
      await tx.productOptionValue.findMany({
        where: { id: { in: inputLines.map((l) => l.optionValueId).filter((id): id is string => !!id) } },
        include: { option: true },
      })
    ).map((v) => [v.id, v]),
  );
  const addOns = new Map(
    (
      await tx.addOn.findMany({
        where: { id: { in: inputLines.map((l) => l.addOnId).filter((id): id is string => !!id) } },
      })
    ).map((a) => [a.id, a]),
  );

  const productLinesByInputId = new Map<string, DraftLineInput>();
  for (const line of inputLines) {
    if (!!line.productId === !!line.addOnId) {
      throw new DomainRuleError("Each line must reference exactly one of productId or addOnId");
    }
    if (line.productId && line.id) {
      if (productLinesByInputId.has(line.id)) {
        throw new DomainRuleError(`Duplicate line id in input: ${line.id}`);
      }
      productLinesByInputId.set(line.id, line);
    }
  }

  const resolved: ResolvedLine[] = [];
  for (const line of inputLines) {
    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      throw new DomainRuleError(`qty must be a positive integer; got ${line.qty}`);
    }

    if (line.productId) {
      if (line.parentLineId) {
        throw new DomainRuleError("A product line cannot have a parentLineId");
      }
      const product = products.get(line.productId);
      if (!product) throw new NotFoundError("Product", line.productId);
      // The draft's season is the catalog boundary: a line priced from a
      // prior-season, inactive, or otherwise out-of-catalog product is a
      // price-integrity bypass (a repeat-swap target is client-supplied).
      if (product.seasonId !== seasonId || !product.active) {
        throw new DomainRuleError(
          `Product ${product.slug} is not in this season's active catalog; expected an active product of season ${seasonId}`,
        );
      }

      let optionValueId: string | null = null;
      let optionLabel: string | null = null;
      let optionPriceDeltaCents = 0;
      if (line.optionValueId) {
        const value = optionValues.get(line.optionValueId);
        if (!value) throw new NotFoundError("ProductOptionValue", line.optionValueId);
        if (value.option.productId !== product.id) {
          throw new DomainRuleError(
            `Option value ${line.optionValueId} does not belong to product ${product.slug}`,
          );
        }
        optionValueId = value.id;
        optionLabel = `${value.option.name}: ${value.label}`;
        optionPriceDeltaCents = value.priceDeltaCents;
      }

      resolved.push({
        id: line.id,
        productId: product.id,
        productName: product.name,
        qty: line.qty,
        unitPriceCents: product.basePriceCents,
        optionValueId,
        optionLabel,
        optionPriceDeltaCents,
        addOnId: null,
        parentInputId: null,
        recipientClientId: line.recipientClientId ?? null,
        lineTotalCents: line.qty * (product.basePriceCents + optionPriceDeltaCents),
      });
    } else {
      const addOn = addOns.get(line.addOnId!);
      if (!addOn) throw new NotFoundError("AddOn", line.addOnId!);
      if (!line.parentLineId) {
        throw new DomainRuleError(`Add-on line ${line.addOnId} must reference a parentLineId`);
      }
      const parentInput = productLinesByInputId.get(line.parentLineId);
      if (!parentInput) {
        throw new DomainRuleError(
          `Add-on line ${line.addOnId} references unknown parent line ${line.parentLineId}`,
        );
      }
      const restriction = await tx.productAddOn.findUnique({
        where: { productId_addOnId: { productId: parentInput.productId!, addOnId: addOn.id } },
      });
      if (!restriction) {
        throw new DomainRuleError(`Add-on ${addOn.slug} is not allowed on product ${parentInput.productId}`);
      }
      if (line.recipientClientId && line.recipientClientId !== parentInput.recipientClientId) {
        throw new DomainRuleError("An add-on line inherits its parent line's recipient");
      }

      resolved.push({
        id: line.id,
        productId: null,
        productName: addOn.name,
        qty: line.qty,
        unitPriceCents: addOn.priceCents,
        optionValueId: null,
        optionLabel: null,
        optionPriceDeltaCents: 0,
        addOnId: addOn.id,
        parentInputId: line.parentLineId,
        recipientClientId: parentInput.recipientClientId ?? null,
        lineTotalCents: line.qty * addOn.priceCents,
      });
    }
  }

  return resolved;
}

// Shared insert: parents first so add-on lines can FK to the real row ids.
// `recipientIds` maps caller recipient clientIds to DraftRecipient row ids.
export async function insertResolvedLines(
  tx: Prisma.TransactionClient,
  orderId: string,
  resolved: ResolvedLine[],
  recipientIds: Map<string, string>,
): Promise<void> {
  const recipientRowId = (clientId: string | null): string | null =>
    clientId ? (recipientIds.get(clientId) ?? null) : null;

  await tx.orderLine.createMany({
    data: resolved
      .filter((line) => line.productId !== null)
      .map((line) => ({
        ...(line.id ? { id: line.id } : {}),
        orderId,
        productId: line.productId,
        productName: line.productName,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        optionValueId: line.optionValueId,
        optionLabel: line.optionLabel,
        optionPriceDeltaCents: line.optionPriceDeltaCents,
        recipientId: recipientRowId(line.recipientClientId),
        lineTotalCents: line.lineTotalCents,
      })),
  });

  const addOnLines = resolved.filter((line) => line.addOnId !== null);
  if (addOnLines.length > 0) {
    await tx.orderLine.createMany({
      data: addOnLines.map((line) => ({
        ...(line.id ? { id: line.id } : {}),
        orderId,
        parentLineId: line.parentInputId,
        addOnId: line.addOnId,
        productName: line.productName,
        qty: line.qty,
        unitPriceCents: line.unitPriceCents,
        recipientId: recipientRowId(line.recipientClientId),
        lineTotalCents: line.lineTotalCents,
      })),
    });
  }
}
