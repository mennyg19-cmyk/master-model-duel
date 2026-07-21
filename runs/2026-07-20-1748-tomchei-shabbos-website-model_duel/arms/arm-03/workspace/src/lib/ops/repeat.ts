import { AuditAction, OrderStatus, SeasonStatus, type Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { err, maskError, ok, type Result } from "@/lib/result";
import { formatDraftRef } from "@/lib/orders/draft-wire";
import { writeAudit } from "@/lib/audit";
import { lockOrderForUpdate } from "@/lib/orders/lock";
import { assertOrderTransition } from "@/lib/orders/state-machine";
import {
  resolveReplacementChain,
  type ResolvedReplacement,
} from "@/lib/catalog/replacements";

type Tx = Prisma.TransactionClient;

export type RepeatLinePreview = {
  sourceLineId: string;
  quantity: number;
  unitPriceCents: number;
  greeting: string | null;
  recipient: {
    recipientName: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
    country: string | null;
    savedAddressId: string | null;
  };
  fulfillmentMethodId: string | null;
  productOptionId: string | null;
  addOns: Array<{ addOnId: string; quantity: number; unitPriceCents: number }>;
  replacement: ResolvedReplacement;
  defaultProductId: string | null;
  requiresPick: boolean;
};

export type RepeatPreview = {
  sourceOrderId: string;
  sourceDraftRef: string;
  sourceSeasonId: string;
  targetSeasonId: string;
  targetSeasonName: string;
  customerId: string | null;
  greetingDefault: string | null;
  lines: RepeatLinePreview[];
  recipients: Array<{
    sourceLineId: string;
    recipientName: string | null;
    addressSummary: string;
    savedAddressId: string | null;
    confirmedByDefault: boolean;
  }>;
  blockers: string[];
};

export type RepeatLineChoice = {
  sourceLineId: string;
  /** map → keep with chosen product; remove → drop the line */
  action: "map" | "remove";
  toProductId?: string | null;
  keepRecipient?: boolean;
  savedAddressId?: string | null;
};

async function resolveTargetSeason(preferredId?: string | null) {
  if (preferredId) {
    const preferred = await db.season.findUniqueOrThrow({ where: { id: preferredId } });
    if (preferred.status !== SeasonStatus.OPEN) {
      throw new Error(`Target season ${preferred.name} is not OPEN.`);
    }
    return preferred;
  }
  const open = await db.season.findFirst({
    where: { status: SeasonStatus.OPEN },
    orderBy: { year: "desc" },
  });
  if (!open) {
    throw new Error("No OPEN season available to repeat into.");
  }
  return open;
}

/** Build middle-review payload (UR-007, G-011, G-012). */
export async function previewRepeatOrder(input: {
  sourceOrderId: string;
  targetSeasonId?: string | null;
}): Promise<Result<RepeatPreview>> {
  try {
    const source = await db.order.findUnique({
      where: { id: input.sourceOrderId },
      include: {
        lines: {
          include: { product: true, addOns: true },
          orderBy: { createdAt: "asc" },
        },
        season: true,
      },
    });
    if (!source) return err("missing", "Order not found.");
    if (
      source.status === OrderStatus.DRAFT ||
      source.status === OrderStatus.DISCARDED
    ) {
      return err("status", "Cannot repeat a draft or discarded order.");
    }

    const target = await resolveTargetSeason(input.targetSeasonId);
    const lines: RepeatLinePreview[] = [];
    const blockers: string[] = [];

    for (const line of source.lines) {
      const replacement = await resolveReplacementChain(line.productId, target.id);
      const defaultProductId = replacement.priceSmartProductId;
      const requiresPick = replacement.needsPick;
      if (requiresPick) {
        blockers.push(
          `Line ${line.id}: ${replacement.sourceName} (${replacement.sourceSku}) has no mapped product in ${target.name}`,
        );
      }
      lines.push({
        sourceLineId: line.id,
        quantity: line.quantity,
        unitPriceCents: line.unitPriceCents,
        greeting: line.greeting,
        recipient: {
          recipientName: line.recipientName,
          addressLine1: line.addressLine1,
          addressLine2: line.addressLine2,
          city: line.city,
          state: line.state,
          postalCode: line.postalCode,
          country: line.country,
          savedAddressId: line.savedAddressId,
        },
        fulfillmentMethodId: line.fulfillmentMethodId,
        productOptionId: line.productOptionId,
        addOns: line.addOns.map((a) => ({
          addOnId: a.addOnId,
          quantity: a.quantity,
          unitPriceCents: a.unitPriceCents,
        })),
        replacement,
        defaultProductId,
        requiresPick,
      });
    }

    return ok({
      sourceOrderId: source.id,
      sourceDraftRef: source.draftRef,
      sourceSeasonId: source.seasonId,
      targetSeasonId: target.id,
      targetSeasonName: target.name,
      customerId: source.customerId,
      greetingDefault: source.greetingDefault,
      lines,
      recipients: lines.map((l) => ({
        sourceLineId: l.sourceLineId,
        recipientName: l.recipient.recipientName,
        addressSummary: [
          l.recipient.addressLine1,
          l.recipient.city,
          l.recipient.state,
          l.recipient.postalCode,
        ]
          .filter(Boolean)
          .join(", "),
        savedAddressId: l.recipient.savedAddressId,
        confirmedByDefault: Boolean(
          l.recipient.recipientName && l.recipient.addressLine1,
        ),
      })),
      blockers,
    });
  } catch (error) {
    return err(maskError(error), "Could not preview repeat.");
  }
}

async function createDraftFromChoices(
  tx: Tx,
  input: {
    sourceOrderId: string;
    targetSeasonId: string;
    greetingDefault: string | null;
    customerId: string | null;
    draftRef: string;
    choices: RepeatLineChoice[];
    previewLines: RepeatLinePreview[];
  },
) {
  const choiceByLine = new Map(input.choices.map((c) => [c.sourceLineId, c]));
  const kept = input.previewLines.filter((l) => {
    const choice = choiceByLine.get(l.sourceLineId);
    if (!choice) return !l.requiresPick && Boolean(l.defaultProductId);
    return choice.action === "map";
  });

  if (kept.length === 0) {
    throw new Error("At least one line must be mapped to create a draft.");
  }

  for (const line of kept) {
    const choice = choiceByLine.get(line.sourceLineId);
    const toProductId =
      choice?.toProductId || line.defaultProductId || null;
    if (!toProductId) {
      throw new Error(`Line ${line.sourceLineId} needs a replacement pick.`);
    }
    const inTarget = await tx.product.findFirst({
      where: { id: toProductId, seasonId: input.targetSeasonId, isActive: true },
    });
    if (!inTarget) {
      throw new Error(`Product ${toProductId} is not active in the target season.`);
    }
  }

  const targetSeason = await tx.season.findUniqueOrThrow({
    where: { id: input.targetSeasonId },
  });
  if (targetSeason.status !== SeasonStatus.OPEN) {
    throw new Error(`Target season ${targetSeason.name} is not OPEN.`);
  }

  const order = await tx.order.create({
    data: {
      seasonId: input.targetSeasonId,
      customerId: input.customerId,
      status: OrderStatus.DRAFT,
      draftRef: input.draftRef,
      greetingDefault: input.greetingDefault,
    },
  });

  for (const line of input.previewLines) {
    const choice = choiceByLine.get(line.sourceLineId);
    if (choice?.action === "remove") continue;
    const toProductId = choice?.toProductId || line.defaultProductId;
    if (!toProductId) continue;

    const product = await tx.product.findUniqueOrThrow({ where: { id: toProductId } });
    const keepRecipient = choice?.keepRecipient !== false;
    const savedAddressId =
      choice?.savedAddressId !== undefined
        ? choice.savedAddressId
        : line.recipient.savedAddressId;

    let optionId = line.productOptionId;
    let optionAdjustCents = 0;
    if (optionId) {
      let opt = await tx.productOption.findFirst({
        where: { id: optionId, productId: product.id },
      });
      if (!opt) {
        opt = await tx.productOption.findFirst({
          where: { productId: product.id, isActive: true },
          orderBy: { sortOrder: "asc" },
        });
      }
      optionId = opt?.id ?? null;
      optionAdjustCents = opt?.priceAdjustmentCents ?? 0;
    }

    const addOnCreates: Array<{
      addOnId: string;
      quantity: number;
      unitPriceCents: number;
    }> = [];
    for (const sourceAddOn of line.addOns) {
      const allowed = await tx.productAddOnAllow.findFirst({
        where: {
          productId: product.id,
          addOnId: sourceAddOn.addOnId,
          addOn: { isActive: true },
        },
        include: { addOn: true },
      });
      if (!allowed) continue;
      addOnCreates.push({
        addOnId: allowed.addOnId,
        quantity: sourceAddOn.quantity,
        unitPriceCents: allowed.addOn.priceCents,
      });
    }

    await tx.orderLine.create({
      data: {
        orderId: order.id,
        productId: product.id,
        productOptionId: optionId,
        quantity: line.quantity,
        unitPriceCents: product.basePriceCents,
        optionAdjustCents,
        recipientName: keepRecipient ? line.recipient.recipientName : null,
        addressLine1: keepRecipient ? line.recipient.addressLine1 : null,
        addressLine2: keepRecipient ? line.recipient.addressLine2 : null,
        city: keepRecipient ? line.recipient.city : null,
        state: keepRecipient ? line.recipient.state : null,
        postalCode: keepRecipient ? line.recipient.postalCode : null,
        country: keepRecipient ? line.recipient.country : null,
        savedAddressId: keepRecipient ? savedAddressId : null,
        fulfillmentMethodId: line.fulfillmentMethodId ?? undefined,
        greeting: line.greeting ?? input.greetingDefault ?? undefined,
        groupingKey: "unassigned",
        addOns: addOnCreates.length ? { create: addOnCreates } : undefined,
      },
    });
  }

  return order;
}

/** Confirm review page selections and create a draft (customer or staff). */
export async function confirmRepeatOrder(input: {
  sourceOrderId: string;
  targetSeasonId?: string | null;
  choices: RepeatLineChoice[];
  actorStaffId?: string | null;
  actorCustomerId?: string | null;
}): Promise<Result<{ draftRef: string; orderId: string }>> {
  try {
    const preview = await previewRepeatOrder({
      sourceOrderId: input.sourceOrderId,
      targetSeasonId: input.targetSeasonId,
    });
    if (!preview.ok) return preview;

    const choiceByLine = new Map(input.choices.map((c) => [c.sourceLineId, c]));
    for (const line of preview.value.lines) {
      const choice = choiceByLine.get(line.sourceLineId);
      if (!choice) {
        if (line.requiresPick) {
          return err(
            "pick",
            `Choose a replacement or remove: ${line.replacement.sourceName}`,
          );
        }
        continue;
      }
      if (choice.action === "map") {
        const toId = choice.toProductId || line.defaultProductId;
        if (!toId) {
          return err(
            "pick",
            `Choose a replacement or remove: ${line.replacement.sourceName}`,
          );
        }
        const allowed =
          line.replacement.candidates.some((c) => c.productId === toId) ||
          line.replacement.alreadyInTarget;
        if (!allowed && toId !== line.defaultProductId) {
          // Still allow any active product in target season (staff override).
          const product = await db.product.findFirst({
            where: {
              id: toId,
              seasonId: preview.value.targetSeasonId,
              isActive: true,
            },
          });
          if (!product) {
            return err("map", `Invalid replacement for ${line.replacement.sourceName}`);
          }
        }
      }
    }

    // Recipients must be explicitly confirmed when present on kept lines.
    for (const line of preview.value.lines) {
      const choice = choiceByLine.get(line.sourceLineId);
      const removing = choice?.action === "remove";
      if (removing) continue;
      const hasRecipient = Boolean(line.recipient.recipientName);
      if (hasRecipient && (!choice || choice.keepRecipient === undefined)) {
        return err(
          "recipients",
          "Confirm each recipient (keep or clear) before continuing.",
        );
      }
    }

    const target = await resolveTargetSeason(
      input.targetSeasonId ?? preview.value.targetSeasonId,
    );
    const draftRef = formatDraftRef(target.year, randomBytes(6).toString("hex"));

    const created = await db.$transaction(async (tx) => {
      const order = await createDraftFromChoices(tx, {
        sourceOrderId: input.sourceOrderId,
        targetSeasonId: target.id,
        greetingDefault: preview.value.greetingDefault,
        customerId: input.actorCustomerId ?? preview.value.customerId,
        draftRef,
        choices: input.choices,
        previewLines: preview.value.lines,
      });
      await writeAudit(
        {
          action: AuditAction.ORDER_REPEATED,
          actorId: input.actorStaffId ?? null,
          meta: {
            orderId: input.sourceOrderId,
            sourceOrderId: input.sourceOrderId,
            newOrderId: order.id,
            draftRef,
            mode: input.actorStaffId ? "staff_confirm" : "customer_confirm",
            customerId: input.actorCustomerId ?? preview.value.customerId,
            targetSeasonId: target.id,
            choices: input.choices,
          },
        },
        tx,
      );
      return order;
    });

    return ok({ draftRef: created.draftRef, orderId: created.id });
  } catch (error) {
    return err(maskError(error), "Could not confirm repeat.");
  }
}

/**
 * Staff single-order repeat (R-057).
 * Auto-applies price-smart defaults when every line maps; otherwise returns needsReview.
 */
export async function repeatOrder(input: {
  sourceOrderId: string;
  staffId: string;
  targetSeasonId?: string | null;
}): Promise<
  Result<
    | { draftRef: string; orderId: string; mode: "auto" }
    | { needsReview: true; preview: RepeatPreview }
  >
> {
  try {
    const preview = await previewRepeatOrder({
      sourceOrderId: input.sourceOrderId,
      targetSeasonId: input.targetSeasonId,
    });
    if (!preview.ok) return preview;

    const allMapped = preview.value.lines.every(
      (l) => !l.requiresPick && l.defaultProductId,
    );
    if (!allMapped) {
      return ok({ needsReview: true, preview: preview.value });
    }

    const choices: RepeatLineChoice[] = preview.value.lines.map((l) => ({
      sourceLineId: l.sourceLineId,
      action: "map" as const,
      toProductId: l.defaultProductId,
      keepRecipient: true,
      savedAddressId: l.recipient.savedAddressId,
    }));
    const confirmed = await confirmRepeatOrder({
      sourceOrderId: input.sourceOrderId,
      targetSeasonId: preview.value.targetSeasonId,
      choices,
      actorStaffId: input.staffId,
    });
    if (!confirmed.ok) return confirmed;
    return ok({ ...confirmed.value, mode: "auto" as const });
  } catch (error) {
    return err(maskError(error), "Could not repeat order.");
  }
}

const MAX_BULK_REPEAT = 25;

/** Bounded bulk-repeat of customer history into the open season (R-058). */
export async function bulkRepeatOrders(input: {
  items: Array<{ orderId: string; expectedVersion: number }>;
  staffId: string;
  targetSeasonId?: string | null;
  /** Required — staff must confirm replacements (defaults) and recipients (UR-007). */
  confirmReplacements: boolean;
  confirmRecipients: boolean;
}): Promise<
  Result<{
    created: Array<{ sourceOrderId: string; draftRef: string; orderId: string }>;
    conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }>;
    skipped: Array<{ orderId: string; reason: string }>;
  }>
> {
  if (input.items.length === 0) {
    return err("empty", "Provide at least one order.");
  }
  if (input.items.length > MAX_BULK_REPEAT) {
    return err("bound", `Bulk repeat capped at ${MAX_BULK_REPEAT}.`);
  }
  if (!input.confirmReplacements || !input.confirmRecipients) {
    return err(
      "confirm",
      "Confirm replacements and recipients before bulk repeat.",
    );
  }

  try {
    const created: Array<{ sourceOrderId: string; draftRef: string; orderId: string }> = [];
    const conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }> = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];

    for (const item of input.items) {
      const source = await db.order.findUnique({ where: { id: item.orderId } });
      if (!source) {
        skipped.push({ orderId: item.orderId, reason: "not_found" });
        continue;
      }
      if (
        source.status === OrderStatus.DRAFT ||
        source.status === OrderStatus.DISCARDED
      ) {
        skipped.push({ orderId: item.orderId, reason: `status_${source.status}` });
        continue;
      }
      if (source.version !== item.expectedVersion) {
        conflicts.push({
          orderId: item.orderId,
          reason: "version_conflict",
          actualVersion: source.version,
        });
        continue;
      }

      const preview = await previewRepeatOrder({
        sourceOrderId: item.orderId,
        targetSeasonId: input.targetSeasonId,
      });
      if (!preview.ok) {
        skipped.push({ orderId: item.orderId, reason: String(preview.error) });
        continue;
      }
      if (preview.value.lines.some((l) => l.requiresPick)) {
        skipped.push({ orderId: item.orderId, reason: "needs_replacement_pick" });
        continue;
      }

      const target = await resolveTargetSeason(
        input.targetSeasonId ?? preview.value.targetSeasonId,
      );
      const draftRef = formatDraftRef(target.year, randomBytes(6).toString("hex"));
      const choices: RepeatLineChoice[] = preview.value.lines.map((l) => ({
        sourceLineId: l.sourceLineId,
        action: "map" as const,
        toProductId: l.defaultProductId,
        keepRecipient: true,
        savedAddressId: l.recipient.savedAddressId,
      }));

      const order = await db.$transaction(async (tx) => {
        const locked = await lockOrderForUpdate(tx, source.id);
        if (locked.version !== item.expectedVersion) return null;
        const bumped = await tx.order.updateMany({
          where: { id: locked.id, version: item.expectedVersion },
          data: { version: { increment: 1 } },
        });
        if (bumped.count !== 1) return null;

        const draft = await createDraftFromChoices(tx, {
          sourceOrderId: locked.id,
          targetSeasonId: target.id,
          greetingDefault: locked.greetingDefault,
          customerId: locked.customerId,
          draftRef,
          choices,
          previewLines: preview.value.lines,
        });
        await writeAudit(
          {
            action: AuditAction.BULK_ACTION_APPLIED,
            actorId: input.staffId,
            meta: {
              action: "bulk_repeat",
              orderId: locked.id,
              sourceOrderId: locked.id,
              newOrderId: draft.id,
              draftRef,
              created: [{ sourceOrderId: locked.id, draftRef, orderId: draft.id }],
            },
          },
          tx,
        );
        return draft;
      });

      if (!order) {
        const fresh = await db.order.findUnique({ where: { id: item.orderId } });
        conflicts.push({
          orderId: item.orderId,
          reason: "version_conflict",
          actualVersion: fresh?.version,
        });
        continue;
      }

      created.push({
        sourceOrderId: item.orderId,
        draftRef: order.draftRef,
        orderId: order.id,
      });
    }

    return ok({ created, conflicts, skipped });
  } catch (error) {
    return err(maskError(error), "Bulk repeat failed.");
  }
}

/** Generic bulk action with state-machine + version guard (B6, B7). */
export async function bulkUpdateOrderStatus(input: {
  items: Array<{ orderId: string; expectedVersion: number }>;
  toStatus: OrderStatus;
  staffId: string;
}): Promise<
  Result<{
    updated: string[];
    conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }>;
    skipped: Array<{ orderId: string; reason: string }>;
  }>
> {
  const allowed = new Set<OrderStatus>([
    OrderStatus.CANCELLED,
    OrderStatus.FULFILLING,
    OrderStatus.COMPLETED,
  ]);
  if (!allowed.has(input.toStatus)) {
    return err("status", `Bulk status ${input.toStatus} not allowed.`);
  }
  if (input.items.length > 100) {
    return err("bound", "Bulk status capped at 100.");
  }

  try {
    const updated: string[] = [];
    const conflicts: Array<{ orderId: string; reason: string; actualVersion?: number }> = [];
    const skipped: Array<{ orderId: string; reason: string }> = [];

    for (const item of input.items) {
      const result = await db.$transaction(async (tx) => {
        const order = await lockOrderForUpdate(tx, item.orderId).catch(() => null);
        if (!order) return { kind: "skipped" as const, reason: "not_found" };
        if (order.version !== item.expectedVersion) {
          return {
            kind: "conflict" as const,
            reason: "version_conflict",
            actualVersion: order.version,
          };
        }
        if (
          order.status === OrderStatus.DRAFT ||
          order.status === OrderStatus.DISCARDED
        ) {
          return { kind: "skipped" as const, reason: `status_${order.status}` };
        }
        try {
          assertOrderTransition(order.status, input.toStatus);
        } catch {
          return {
            kind: "skipped" as const,
            reason: `illegal_transition_${order.status}_to_${input.toStatus}`,
          };
        }
        const bumped = await tx.order.updateMany({
          where: { id: order.id, version: item.expectedVersion },
          data: { status: input.toStatus, version: { increment: 1 } },
        });
        if (bumped.count !== 1) {
          return {
            kind: "conflict" as const,
            reason: "version_conflict",
            actualVersion: order.version,
          };
        }
        await writeAudit(
          {
            action: AuditAction.BULK_ACTION_APPLIED,
            actorId: input.staffId,
            meta: {
              action: "bulk_status",
              orderId: order.id,
              toStatus: input.toStatus,
              updated: [order.id],
            },
          },
          tx,
        );
        return { kind: "updated" as const };
      });

      if (result.kind === "updated") updated.push(item.orderId);
      else if (result.kind === "conflict") {
        conflicts.push({
          orderId: item.orderId,
          reason: result.reason,
          actualVersion: result.actualVersion,
        });
      } else {
        skipped.push({ orderId: item.orderId, reason: result.reason });
      }
    }

    return ok({ updated, conflicts, skipped });
  } catch (error) {
    return err(maskError(error), "Bulk status update failed.");
  }
}
