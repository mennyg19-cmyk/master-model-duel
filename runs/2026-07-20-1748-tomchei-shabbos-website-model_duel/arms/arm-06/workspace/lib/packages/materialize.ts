import { FulfillmentChoice, Prisma } from "@prisma/client";
import { DomainRuleError } from "@/lib/errors";
import { effectiveGreeting } from "@/lib/checkout/fulfillment";
import { groupPackageInputs } from "@/lib/packages/grouping";
import { PackageEventAction } from "@/lib/packages/stages";

// UR-001: a finalized order explodes into packages through the P2 grouping
// engine. Every recipient with a fulfillment choice contributes one grouping
// input per package identity; identical keys (recipient + address + method +
// greeting, normalized) merge into ONE package, any difference splits.
// Runs inside the finalize transaction so packages, the number claim, and the
// stock commit roll back together.

// Checkout choices map onto the data-driven methods (R-153): both delivery
// flavors run the DELIVERY stage list, pickup runs PICKUP.
export function methodCodeForChoice(choice: FulfillmentChoice): string {
  return choice === "PICKUP" ? "PICKUP" : "DELIVERY";
}

export async function materializePackagesTx(tx: Prisma.TransactionClient, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    include: { recipients: { orderBy: { createdAt: "asc" } }, lines: true },
  });
  if (!order) throw new DomainRuleError(`Order ${orderId} vanished mid-finalize; expected it to exist`);

  const chosen = order.recipients.filter((recipient) => recipient.fulfillmentChoice !== null);
  if (chosen.length === 0) return;

  const methodCodes = [...new Set(chosen.map((recipient) => methodCodeForChoice(recipient.fulfillmentChoice!)))];
  const methods = await tx.fulfillmentMethod.findMany({ where: { code: { in: methodCodes }, active: true } });
  const methodByCode = new Map(methods.map((method) => [method.code, method]));
  for (const code of methodCodes) {
    if (!methodByCode.has(code)) {
      throw new DomainRuleError(`Fulfillment method ${code} is missing or inactive; expected an active method to materialize packages`);
    }
  }

  // One grouping input per recipient row that owns at least one line. The
  // grouping key embeds the recipient's book-address id (or the pickup
  // sentinel), exactly like the P2 engine contract.
  const inputs = chosen
    .map((recipient) => ({
      recipient,
      lines: order.lines.filter((line) => line.recipientId === recipient.id),
    }))
    .filter((entry) => entry.lines.length > 0)
    .map((entry) => ({
      recipientName: entry.recipient.name,
      recipientAddressId: entry.recipient.fulfillmentChoice === "PICKUP" ? null : entry.recipient.addressId,
      fulfillmentMethodCode: methodCodeForChoice(entry.recipient.fulfillmentChoice!),
      greeting: effectiveGreeting(entry.recipient.greeting, order.greetingDefault),
      recipient: entry.recipient,
      lines: entry.lines,
    }));

  const groups = groupPackageInputs(inputs);
  for (const [groupingKey, members] of groups) {
    const first = members[0];
    const method = methodByCode.get(first.fulfillmentMethodCode)!;
    const pkg = await tx.package.create({
      data: {
        orderId: order.id,
        recipientName: first.recipientName,
        recipientAddressId: first.recipientAddressId,
        fulfillmentMethodId: method.id,
        greeting: first.greeting,
        groupingKey,
        channel: first.recipient.fulfillmentChoice!,
        deliveryDay: first.recipient.deliveryDay,
      },
    });
    // Merged recipients (same key on two recipient rows) pour their lines
    // into the shared package; equal lines across members stay separate rows.
    await tx.packageLine.createMany({
      data: members.flatMap((member) =>
        member.lines.map((line) => ({ packageId: pkg.id, orderLineId: line.id, qty: line.qty })),
      ),
    });
    const action: PackageEventAction = "materialize";
    await tx.packageEvent.create({
      data: {
        packageId: pkg.id,
        action,
        metadata: { lineCount: members.reduce((sum, member) => sum + member.lines.length, 0) },
      },
    });
  }
}
