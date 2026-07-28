import { Order } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DomainRuleError, NotFoundError } from "@/lib/errors";
import { claimDraftRef } from "@/lib/orders/numbers";

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
}

interface ResolvedLine {
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
  lineTotalCents: number;
}

export async function createDraftOrder(input: {
  seasonId: string;
  customerId: string;
  lines: DraftLineInput[];
}): Promise<Order> {
  return prisma.$transaction(async (tx) => {
    const season = await tx.season.findUnique({ where: { id: input.seasonId } });
    if (!season) throw new NotFoundError("Season", input.seasonId);
    if (season.status !== "OPEN") {
      throw new DomainRuleError(`Season ${season.name} is closed; expected OPEN to create orders`);
    }
    if (input.lines.length === 0) {
      throw new DomainRuleError("Order must have at least one line");
    }

    // Batch-load every referenced catalog row; the maps double as existence
    // proof — any id not in its map is fabricated.
    const products = new Map(
      (
        await tx.product.findMany({
          where: { id: { in: input.lines.map((l) => l.productId).filter((id): id is string => !!id) } },
        })
      ).map((p) => [p.id, p]),
    );
    const optionValues = new Map(
      (
        await tx.productOptionValue.findMany({
          where: { id: { in: input.lines.map((l) => l.optionValueId).filter((id): id is string => !!id) } },
          include: { option: true },
        })
      ).map((v) => [v.id, v]),
    );
    const addOns = new Map(
      (
        await tx.addOn.findMany({
          where: { id: { in: input.lines.map((l) => l.addOnId).filter((id): id is string => !!id) } },
        })
      ).map((a) => [a.id, a]),
    );

    const productLinesByInputId = new Map<string, DraftLineInput>();
    for (const line of input.lines) {
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
    for (const line of input.lines) {
      if (!Number.isInteger(line.qty) || line.qty <= 0) {
        throw new DomainRuleError(`qty must be a positive integer; got ${line.qty}`);
      }

      if (line.productId) {
        if (line.parentLineId) {
          throw new DomainRuleError("A product line cannot have a parentLineId");
        }
        const product = products.get(line.productId);
        if (!product) throw new NotFoundError("Product", line.productId);

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
          lineTotalCents: line.qty * addOn.priceCents,
        });
      }
    }

    const draftRef = await claimDraftRef(tx, season.id, season.name);
    const totalCents = resolved.reduce((sum, line) => sum + line.lineTotalCents, 0);

    // Parents first so add-on lines can FK to the real row ids.
    const order = await tx.order.create({
      data: {
        seasonId: season.id,
        customerId: input.customerId,
        draftRef,
        totalCents,
        lines: {
          create: resolved
            .filter((line) => line.productId !== null)
            .map((line) => ({
              ...(line.id ? { id: line.id } : {}),
              productId: line.productId,
              productName: line.productName,
              qty: line.qty,
              unitPriceCents: line.unitPriceCents,
              optionValueId: line.optionValueId,
              optionLabel: line.optionLabel,
              optionPriceDeltaCents: line.optionPriceDeltaCents,
              lineTotalCents: line.lineTotalCents,
            })),
        },
      },
      include: { lines: true },
    });

    const addOnLines = resolved.filter((line) => line.addOnId !== null);
    if (addOnLines.length > 0) {
      await tx.orderLine.createMany({
        data: addOnLines.map((line) => ({
          ...(line.id ? { id: line.id } : {}),
          orderId: order.id,
          parentLineId: line.parentInputId,
          addOnId: line.addOnId,
          productName: line.productName,
          qty: line.qty,
          unitPriceCents: line.unitPriceCents,
          lineTotalCents: line.lineTotalCents,
        })),
      });
    }

    return tx.order.findUniqueOrThrow({ where: { id: order.id }, include: { lines: true } });
  });
}
