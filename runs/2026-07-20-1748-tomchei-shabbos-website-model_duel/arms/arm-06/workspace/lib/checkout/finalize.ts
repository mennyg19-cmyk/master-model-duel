import { Order, Prisma } from "@prisma/client";
import { finalizeOrderTx } from "@/lib/orders/state-machine";
import { commitStockTx } from "@/lib/inventory/reserve";
import { effectiveGreeting } from "@/lib/checkout/fulfillment";
import { inventoryNeedsForLines } from "@/lib/checkout/reservations";
import { OrderForCheckout } from "@/lib/checkout/order-load";

// Shared finalize core for a submitted draft (webhook completion and POS
// counter finalize): the reservation converts to a commit — never a double
// count — and the effective greeting is remembered on each book-linked
// recipient (G-020). Runs inside the caller's transaction so the stock
// commit, number claim, and any payment post roll back together.
export async function commitSubmittedOrder(
  tx: Prisma.TransactionClient,
  order: OrderForCheckout,
): Promise<Order> {
  const needs = await inventoryNeedsForLines(tx, order.lines);
  for (const [itemId, qty] of needs) {
    await commitStockTx(tx, itemId, qty, true);
  }
  await tx.order.update({ where: { id: order.id }, data: { stockReserved: false } });
  const finalized = await finalizeOrderTx(tx, order.id);
  for (const recipient of order.recipients) {
    if (!recipient.addressId) continue;
    const greeting = effectiveGreeting(recipient.greeting, order.greetingDefault);
    if (greeting) {
      await tx.address.update({ where: { id: recipient.addressId }, data: { lastGreeting: greeting } });
    }
  }
  return finalized;
}
