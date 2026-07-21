import { createHash } from "node:crypto";
import {
  OrderStatus,
  Prisma,
  ProductKind,
  SeasonStatus,
  type PrismaClient,
} from "@prisma/client";
import { z } from "zod";
import { normalizeEmail, normalizePhone } from "@/lib/normalize";

export const MAX_LEGACY_IMPORT_BYTES = 10 * 1024 * 1024;
const MAX_LEGACY_ENTITIES = 25_000;
const MAX_LEGACY_ADDRESSES = 100_000;
const MAX_LEGACY_ORDER_LINES = 100_000;

const legacyAddressSchema = z.object({
  id: z.string().min(1).max(120),
  recipientName: z.string().min(1).max(200),
  line1: z.string().min(1).max(250),
  line2: z.string().max(250).optional(),
  city: z.string().max(120),
  region: z.string().max(80),
  postalCode: z.string().max(30),
  greeting: z.string().max(2_000).optional(),
});

export const legacyDocumentSchema = z.object({
  customers: z.array(z.object({
    id: z.string().min(1).max(120),
    displayName: z.string().min(1).max(200),
    email: z.string().max(320).optional(),
    phone: z.string().max(80).optional(),
    allowLiveCustomerMerge: z.boolean().optional(),
    addresses: z.array(legacyAddressSchema).max(MAX_LEGACY_ADDRESSES).optional(),
  })).max(MAX_LEGACY_ENTITIES),
  products: z.array(z.object({
    id: z.string().min(1).max(120),
    seasonYear: z.number().int().min(1900).max(2200),
    sku: z.string().min(1).max(120),
    name: z.string().min(1).max(250),
    priceCents: z.number().int().nonnegative(),
  })).max(MAX_LEGACY_ENTITIES),
  orders: z.array(z.object({
    id: z.string().min(1).max(120),
    seasonYear: z.number().int().min(1900).max(2200),
    customerId: z.string().min(1).max(120),
    orderNumber: z.number().int().positive().optional(),
    totalCents: z.number().int().nonnegative(),
    donationCents: z.number().int().nonnegative().optional(),
    lines: z.array(z.object({
      productId: z.string().min(1).max(120),
      quantity: z.number().int().positive().max(1_000),
      addressId: z.string().min(1).max(120).optional(),
      greeting: z.string().max(2_000).optional(),
    })).min(1).max(MAX_LEGACY_ORDER_LINES),
  })).max(MAX_LEGACY_ENTITIES),
}).superRefine((document, context) => {
  const addressCount = document.customers.reduce(
    (sum, customer) => sum + (customer.addresses?.length ?? 0),
    0,
  );
  const lineCount = document.orders.reduce(
    (sum, order) => sum + order.lines.length,
    0,
  );
  if (addressCount > MAX_LEGACY_ADDRESSES) {
    context.addIssue({ code: "custom", message: "Legacy document contains too many addresses." });
  }
  if (lineCount > MAX_LEGACY_ORDER_LINES) {
    context.addIssue({ code: "custom", message: "Legacy document contains too many order lines." });
  }
});

export type LegacyDocument = z.infer<typeof legacyDocumentSchema>;
type LegacyAddress = z.infer<typeof legacyAddressSchema>;

export class ImportConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportConflictError";
  }
}

function normalizeAddress(address: LegacyAddress) {
  return [
    address.recipientName,
    address.line1,
    address.line2 ?? "",
    address.city,
    address.region,
    address.postalCode,
  ]
    .map((part) => part.trim().replace(/\s+/g, " ").toLowerCase())
    .join("|");
}

function countDocument(document: LegacyDocument) {
  return {
    customers: document.customers.length,
    addresses: document.customers.reduce(
      (sum, customer) => sum + (customer.addresses?.length ?? 0),
      0,
    ),
    products: document.products.length,
    orders: document.orders.length,
    orderLines: document.orders.reduce(
      (sum, order) => sum + order.lines.length,
      0,
    ),
  };
}

export function inspectLegacyDocument(document: LegacyDocument) {
  const issues: Array<{
    severity: "BLOCKING" | "REVIEW";
    entity: string;
    sourceId: string;
    message: string;
  }> = [];
  const customerIds = new Set(document.customers.map((customer) => customer.id));
  const productIds = new Set(document.products.map((product) => product.id));
  const addressIds = new Set(
    document.customers.flatMap((customer) =>
      (customer.addresses ?? []).map((address) => address.id),
    ),
  );
  for (const customer of document.customers) {
    if (!customer.id || !customer.displayName.trim()) {
      issues.push({
        severity: "BLOCKING",
        entity: "customer",
        sourceId: customer.id || "missing",
        message: "Customer ID and display name are required.",
      });
    }
    if (!normalizeEmail(customer.email ?? "") && !normalizePhone(customer.phone ?? "")) {
      issues.push({
        severity: "REVIEW",
        entity: "customer",
        sourceId: customer.id,
        message: "Customer has no usable email or phone.",
      });
    }
    for (const address of customer.addresses ?? []) {
      if (!address.city.trim() || !address.postalCode.trim()) {
        issues.push({
          severity: "REVIEW",
          entity: "address",
          sourceId: address.id,
          message: "Address needs city or postal-code review.",
        });
      }
    }
  }
  for (const product of document.products) {
    if (
      !product.id ||
      !product.sku.trim() ||
      !product.name.trim() ||
      !Number.isInteger(product.priceCents) ||
      product.priceCents < 0
    ) {
      issues.push({
        severity: "BLOCKING",
        entity: "product",
        sourceId: product.id || "missing",
        message: "Product requires ID, SKU, name, and non-negative cents.",
      });
    }
  }
  for (const order of document.orders) {
    if (!customerIds.has(order.customerId)) {
      issues.push({
        severity: "BLOCKING",
        entity: "order",
        sourceId: order.id,
        message: `Customer ${order.customerId} is missing.`,
      });
    }
    for (const line of order.lines) {
      if (!productIds.has(line.productId)) {
        issues.push({
          severity: "BLOCKING",
          entity: "order",
          sourceId: order.id,
          message: `Product ${line.productId} is missing.`,
        });
      }
      if (line.addressId && !addressIds.has(line.addressId)) {
        issues.push({
          severity: "BLOCKING",
          entity: "order",
          sourceId: order.id,
          message: `Recipient address ${line.addressId} is missing.`,
        });
      }
    }
  }
  return {
    issues,
    sourceCounts: countDocument(document),
    sourceTotals: {
      orderTotalCents: document.orders.reduce(
        (sum, order) => sum + order.totalCents,
        0,
      ),
    },
  };
}

export async function stageLegacyImport(
  db: PrismaClient,
  input: {
    sourceName: string;
    document: LegacyDocument;
    dryRun: boolean;
    stagedByStaffId: string;
  },
) {
  const inspection = inspectLegacyDocument(input.document);
  const checkpointKey = createHash("sha256")
    .update(JSON.stringify(input.document))
    .digest("hex");
  return db.legacyImportBatch.upsert({
    where: { checkpointKey },
    update: {
      dryRun: input.dryRun,
      issues: inspection.issues,
    },
    create: {
      checkpointKey,
      sourceName: input.sourceName,
      dryRun: input.dryRun,
      payload: input.document as unknown as Prisma.InputJsonValue,
      mappings: {},
      issues: inspection.issues,
      sourceCounts: inspection.sourceCounts,
      sourceTotals: inspection.sourceTotals,
      stagedByStaffId: input.stagedByStaffId,
    },
  });
}

export async function commitLegacyImport(
  db: PrismaClient,
  batchId: string,
  staffUserId: string,
) {
  return db.$transaction(
    async (transaction) => {
      const batch = await transaction.legacyImportBatch.findUniqueOrThrow({
        where: { id: batchId },
      });
      if (batch.status === "COMMITTED") return batch;
      const issues = batch.issues as Array<{ severity: string }>;
      if (issues.some((issue) => issue.severity === "BLOCKING")) {
        throw new ImportConflictError("Resolve every blocking legacy-import issue before commit.");
      }
      const claimed = await transaction.legacyImportBatch.updateMany({
        where: { id: batchId, status: { in: ["STAGED", "COMMITTING"] } },
        data: { status: "COMMITTING" },
      });
      if (claimed.count !== 1) {
        throw new ImportConflictError("Legacy import is not in a resumable state.");
      }
      const document = batch.payload as unknown as LegacyDocument;
      const customerMap = new Map<string, string>();
      const addressMap = new Map<string, string>();
      const productMap = new Map<string, string>();
      const seasonMap = new Map<number, string>();
      const sourceProducts = new Map(
        document.products.map((product) => [product.id, product]),
      );
      const recipientNames = new Map(
        document.customers.flatMap((customer) =>
          (customer.addresses ?? []).map((address) => [address.id, address.recipientName] as const),
        ),
      );
      const customerNames = new Map(
        document.customers.map((customer) => [customer.id, customer.displayName]),
      );

      for (const year of new Set([
        ...document.products.map((product) => product.seasonYear),
        ...document.orders.map((order) => order.seasonYear),
      ])) {
        const season = await transaction.season.upsert({
          where: { year },
          update: {},
          create: { year, name: `Purim ${year}`, status: SeasonStatus.CLOSED },
        });
        seasonMap.set(year, season.id);
      }
      for (const sourceCustomer of document.customers) {
        const emailNormalized = sourceCustomer.email
          ? normalizeEmail(sourceCustomer.email)
          : null;
        const phoneNormalized = sourceCustomer.phone
          ? normalizePhone(sourceCustomer.phone)
          : null;
        const existing = await transaction.customer.findFirst({
          where: {
            OR: [
              { legacySourceId: sourceCustomer.id },
              ...(emailNormalized ? [{ emailNormalized }] : []),
              ...(phoneNormalized ? [{ phoneNormalized }] : []),
            ],
          },
        });
        if (
          existing &&
          !existing.legacySourceId &&
          !sourceCustomer.allowLiveCustomerMerge
        ) {
          throw new ImportConflictError(
            `Customer ${sourceCustomer.id} matches a live customer; set allowLiveCustomerMerge to confirm the merge.`,
          );
        }
        const customer =
          existing ??
          (await transaction.customer.create({
            data: {
              legacySourceId: sourceCustomer.id,
              displayName: sourceCustomer.displayName.trim(),
              email: sourceCustomer.email?.trim() || null,
              emailNormalized,
              phone: sourceCustomer.phone?.trim() || null,
              phoneNormalized,
            },
          }));
        customerMap.set(sourceCustomer.id, customer.id);
        for (const sourceAddress of sourceCustomer.addresses ?? []) {
          const normalizedKey = normalizeAddress(sourceAddress);
          const needsReview =
            !sourceAddress.city.trim() || !sourceAddress.postalCode.trim();
          const address = await transaction.customerAddress.upsert({
            where: {
              customerId_normalizedKey: {
                customerId: customer.id,
                normalizedKey,
              },
            },
            update: {
              rememberedGreeting: sourceAddress.greeting?.trim() || undefined,
              validationStatus: needsReview ? "REVIEW" : "VALID",
              reviewReason: needsReview
                ? "Imported address is missing city or postal code."
                : null,
            },
            create: {
              legacySourceId: sourceAddress.id,
              customerId: customer.id,
              recipientName: sourceAddress.recipientName.trim(),
              line1: sourceAddress.line1.trim(),
              line2: sourceAddress.line2?.trim() || null,
              city: sourceAddress.city.trim(),
              region: sourceAddress.region.trim(),
              postalCode: sourceAddress.postalCode.trim(),
              normalizedKey,
              rememberedGreeting: sourceAddress.greeting?.trim() || null,
              validationStatus: needsReview ? "REVIEW" : "VALID",
              reviewReason: needsReview
                ? "Imported address is missing city or postal code."
                : null,
            },
          });
          addressMap.set(sourceAddress.id, address.id);
        }
      }
      for (const sourceProduct of document.products) {
        const seasonId = seasonMap.get(sourceProduct.seasonYear);
        if (!seasonId) throw new Error("Product season mapping is missing.");
        const product = await transaction.product.upsert({
          where: { legacySourceId: sourceProduct.id },
          update: {},
          create: {
            legacySourceId: sourceProduct.id,
            seasonId,
            sku: sourceProduct.sku.trim().toUpperCase(),
            name: sourceProduct.name.trim(),
            kind: ProductKind.PACKAGE,
            priceCents: sourceProduct.priceCents,
            isFinishedPackage: true,
          },
        });
        productMap.set(sourceProduct.id, product.id);
      }
      const nextNumberBySeason = new Map<number, number>();
      for (const sourceOrder of [...document.orders].sort(
        (left, right) =>
          left.seasonYear - right.seasonYear ||
          (left.orderNumber ?? Number.MAX_SAFE_INTEGER) -
            (right.orderNumber ?? Number.MAX_SAFE_INTEGER) ||
          left.id.localeCompare(right.id),
      )) {
        const seasonId = seasonMap.get(sourceOrder.seasonYear);
        const customerId = customerMap.get(sourceOrder.customerId);
        if (!seasonId || !customerId) throw new Error("Order mapping is incomplete.");
        let orderNumber = nextNumberBySeason.get(sourceOrder.seasonYear);
        if (!orderNumber) {
          const latest = await transaction.order.aggregate({
            where: { seasonId },
            _max: { orderNumber: true },
          });
          orderNumber = (latest._max.orderNumber ?? 0) + 1;
        }
        nextNumberBySeason.set(sourceOrder.seasonYear, orderNumber + 1);
        await transaction.order.upsert({
          where: { legacySourceId: sourceOrder.id },
          update: {},
          create: {
            legacySourceId: sourceOrder.id,
            seasonId,
            customerId,
            status: OrderStatus.FINALIZED,
            orderNumber,
            draftReference: `LEGACY-${sourceOrder.seasonYear}-${sourceOrder.id}`,
            subtotalCents: sourceOrder.totalCents - (sourceOrder.donationCents ?? 0),
            donationCents: sourceOrder.donationCents ?? 0,
            totalCents: sourceOrder.totalCents,
            finalizedAt: new Date(),
            lines: {
              create: sourceOrder.lines.map((line) => {
                const productId = productMap.get(line.productId);
                const sourceProduct = sourceProducts.get(line.productId);
                if (!productId || !sourceProduct) {
                  throw new Error("Order product mapping is incomplete.");
                }
                return {
                  productId,
                  recipientAddressId: line.addressId
                    ? addressMap.get(line.addressId)
                    : null,
                  recipientSource: line.addressId ? "ADDRESS_BOOK" : "ON_ORDER",
                  recipientNameSnapshot: line.addressId
                    ? recipientNames.get(line.addressId)
                    : customerNames.get(sourceOrder.customerId),
                  greetingSnapshot: line.greeting ?? "",
                  productNameSnapshot: sourceProduct.name,
                  skuSnapshot: sourceProduct.sku,
                  unitPriceCentsSnapshot: sourceProduct.priceCents,
                  quantity: line.quantity,
                };
              }),
            },
          },
        });
      }
      const importedCounts = countDocument(document);
      const importedTotals = {
        orderTotalCents: document.orders.reduce(
          (sum, order) => sum + order.totalCents,
          0,
        ),
      };
      await transaction.auditLog.create({
        data: {
          actorStaffId: staffUserId,
          action: "legacy_import.committed",
          targetType: "LegacyImportBatch",
          targetId: batch.id,
          metadata: { importedCounts, importedTotals },
        },
      });
      return transaction.legacyImportBatch.update({
        where: { id: batch.id },
        data: {
          status: "COMMITTED",
          dryRun: false,
          importedCounts,
          importedTotals,
          committedByStaffId: staffUserId,
          committedAt: new Date(),
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
