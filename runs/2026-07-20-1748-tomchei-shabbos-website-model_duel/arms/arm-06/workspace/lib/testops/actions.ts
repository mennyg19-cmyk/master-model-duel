import { Prisma, PrismaClient } from "@prisma/client";
import { SeedCounts, seedBaseline } from "@/lib/testops/baseline-seed";

// R-101/R-129: the test-console actions. Wipes are single TRUNCATE statements
// (CASCADE handles FK order), never per-row deletes — fast enough to run
// between rehearsal acts and impossible to leave half-done.
//
// Identity and audit survive every action: the operator stays logged in and
// the testops audit trail (testops_*) is exactly the record of what was
// wiped. Everything else is fair game.
type Db = PrismaClient | Prisma.TransactionClient;

// Everything except staff_users / permission_overrides / auth_sessions /
// audit_logs. Table names = @@map values in prisma/schema.prisma.
const WIPE_TABLES = [
  "reconciliation_findings",
  "reconciliation_runs",
  "email_campaign_recipients",
  "email_campaigns",
  "email_triggered_overrides",
  "email_templates",
  "email_list_memberships",
  "email_lists",
  "newsletter_subscribers",
  "outbox_messages",
  "route_events",
  "driver_route_links",
  "route_stops",
  "delivery_routes",
  "bulk_delivery_schedule_items",
  "bulk_delivery_schedules",
  "assembly_batches",
  "bom_lines",
  "ingredients",
  "media_assets",
  "geocode_cache",
  "inventory_items",
  "shipment_boxes",
  "package_types",
  "pickup_locations",
  "shipments",
  "shipping_quotes",
  "stripe_webhook_events",
  "stripe_payment_intents",
  "payments",
  "package_events",
  "fulfillment_methods",
  "print_batch_items",
  "print_batches",
  "package_lines",
  "packages",
  "order_lines",
  "draft_recipients",
  "orders",
  "addresses",
  "customer_sessions",
  "customers",
  "import_batches",
  "cron_runs",
  "product_add_ons",
  "add_ons",
  "product_option_values",
  "product_options",
  "products",
  "seasons",
  "settings",
];

// Clear = transactional data only: the season, catalog, customers, and
// settings survive; the rehearsal's orders/fulfillment/payment trail goes.
const CLEAR_TABLES = [
  "reconciliation_findings",
  "reconciliation_runs",
  "email_campaign_recipients",
  "email_campaigns",
  "outbox_messages",
  "route_events",
  "driver_route_links",
  "route_stops",
  "delivery_routes",
  "bulk_delivery_schedule_items",
  "bulk_delivery_schedules",
  "assembly_batches",
  "geocode_cache",
  "shipments",
  "shipping_quotes",
  "stripe_webhook_events",
  "stripe_payment_intents",
  "payments",
  "package_events",
  "print_batch_items",
  "print_batches",
  "package_lines",
  "packages",
  "order_lines",
  "draft_recipients",
  "orders",
  "import_batches",
  "cron_runs",
];

export type TestOpsAction = "seed" | "clear" | "wipe" | "reset";

export interface TestOpsResult {
  action: TestOpsAction;
  counts?: SeedCounts;
}

async function truncateAll(db: Db, tables: string[]): Promise<void> {
  const list = tables.map((table) => `"${table}"`).join(", ");
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

export async function runTestOps(prisma: PrismaClient, action: TestOpsAction): Promise<TestOpsResult> {
  switch (action) {
    case "seed":
      return { action, counts: await seedBaseline(prisma) };
    case "wipe":
      await truncateAll(prisma, WIPE_TABLES);
      return { action };
    case "clear":
      await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
        await truncateAll(tx, CLEAR_TABLES);
        // Reservations belong to deleted orders; counters restart the season.
        await tx.inventoryItem.updateMany({ data: { reserved: 0 } });
        await tx.season.updateMany({ data: { lastOrderSeq: 0, lastDraftSeq: 0 } });
      });
      return { action };
    case "reset":
      await truncateAll(prisma, WIPE_TABLES);
      return { action, counts: await seedBaseline(prisma) };
  }
}
