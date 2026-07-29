// Unit checks for P7 pure helpers: choice→method mapping, filing-group keys,
// data-driven stage advance legality, package-board param parsing, and the
// pure PDF renderers (slips/labels/cards) over an in-memory batch fixture —
// including WinAnsi sanitization of smart punctuation. DB-backed P7 behavior
// (materialize on finalize, split/regroup, batches, dashboard) lives in
// test-p7-domain.mts.

process.env.DATABASE_URL ??= "postgresql://postgres:postgres@127.0.0.1:4106/app";
process.env.AUTH_SECRET ??= "0123456789abcdef0123456789abcdef";

let failures = 0;

function check(label: string, condition: boolean) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`);
  } else {
    console.log(`ok: ${label}`);
  }
}

// --- choice → method code -------------------------------------------------
const { methodCodeForChoice } = await import("../lib/packages/materialize");

check("pickup maps to the PICKUP method", methodCodeForChoice("PICKUP") === "PICKUP");
check(
  "both delivery flavors map to the DELIVERY method",
  methodCodeForChoice("BULK_DELIVERY") === "DELIVERY" && methodCodeForChoice("PER_PACKAGE_DELIVERY") === "DELIVERY",
);

// --- filing-group key -------------------------------------------------------
const { filingGroupForChannel } = await import("../lib/packages/print-batches");

check(
  "filing group is the fulfillment channel (one PDF stack per channel)",
  filingGroupForChannel("PICKUP") === "PICKUP"
    && filingGroupForChannel("BULK_DELIVERY") === "BULK_DELIVERY"
    && filingGroupForChannel("PER_PACKAGE_DELIVERY") === "PER_PACKAGE_DELIVERY",
);

// --- stage legality (data-driven) --------------------------------------------
const { canAdvanceStage } = await import("../lib/packages/stages");

const DELIVERY_STAGES = ["NEW", "PRINTED", "PACKED", "SENT"] as const;
const PICKUP_STAGES = ["NEW", "PACKED", "PICKED_UP"] as const;
check("delivery: NEW → PRINTED is legal", canAdvanceStage("NEW", "PRINTED", DELIVERY_STAGES));
check("delivery: skipping ahead NEW → SENT is legal (forward-only, not adjacent-only)", canAdvanceStage("NEW", "SENT", DELIVERY_STAGES));
check("delivery: backward PACKED → PRINTED is illegal", !canAdvanceStage("PACKED", "PRINTED", DELIVERY_STAGES));
check("delivery: same stage is not an advance", !canAdvanceStage("PACKED", "PACKED", DELIVERY_STAGES));
check(
  "pickup skips PRINTED entirely: NEW → PRINTED and PRINTED → PACKED both illegal",
  !canAdvanceStage("NEW", "PRINTED", PICKUP_STAGES) && !canAdvanceStage("PRINTED", "PACKED", PICKUP_STAGES),
);
check("pickup: NEW → PACKED and PACKED → PICKED_UP legal", canAdvanceStage("NEW", "PACKED", PICKUP_STAGES) && canAdvanceStage("PACKED", "PICKED_UP", PICKUP_STAGES));

// --- package board params + where --------------------------------------------
const { buildPackageWhere, parsePackageBoardParams } = await import("../lib/packages/board");

const boardDefaults = parsePackageBoardParams({});
check(
  "board defaults: no filters, page 1",
  boardDefaults.q === null && boardDefaults.stage === null && boardDefaults.channel === null && boardDefaults.page === 1,
);
const boardParsed = parsePackageBoardParams({ q: "  bubby ", stage: "PRINTED", channel: "NOPE", page: "2" });
check(
  "board parse: q trims, valid stage keeps, invalid channel drops",
  boardParsed.q === "bubby" && boardParsed.stage === "PRINTED" && boardParsed.channel === null && boardParsed.page === 2,
);
const boardWhere = buildPackageWhere("season-1", boardDefaults) as Record<string, unknown>;
check(
  "board where without filters scopes packages through their order's season",
  JSON.stringify(boardWhere) === JSON.stringify({ order: { seasonId: "season-1" } }),
);
const boardWhereQ = buildPackageWhere("season-1", { ...boardDefaults, q: "MM-2026" }) as { OR: unknown[] };
check("board search hits recipient, greeting, and order wire format", boardWhereQ.OR.length === 3);
const boardWhereFilters = buildPackageWhere("season-1", { ...boardDefaults, stage: "SENT", channel: "PICKUP" }) as Record<string, unknown>;
check(
  "board stage + channel filters land on the where",
  boardWhereFilters.stage === "SENT" && boardWhereFilters.channel === "PICKUP",
);

// --- pure PDF renderers ---------------------------------------------------------
const { renderBatchPdf } = await import("../lib/print/pdf");
import type { BatchPrintData } from "../lib/print/pdf";

const fixture: BatchPrintData = {
  id: "batch-test-1",
  filingGroup: "BULK_DELIVERY",
  trigger: "NIGHTLY",
  createdAt: new Date("2026-07-29T00:00:00Z"),
  orders: [
    {
      id: "order-1",
      wireFormat: "MM-TEST-0001",
      orderNumber: 1,
      customerName: "P7 Customer",
      packages: [
        {
          id: "pkg-1",
          recipientName: "Bubby Kohn",
          channel: "BULK_DELIVERY",
          deliveryDay: "Purim Eve",
          greeting: "Happy Purim — “best” box…",
          address: { line1: "9 Hilltop Rd", line2: null, city: "Lakewood", region: "NJ", postalCode: "08701" },
          lines: [
            { orderLineId: "l1", productName: "Deluxe Box", qty: 2, optionLabel: "Large", parentLineId: null },
            { orderLineId: "l1a", productName: "Ribbon", qty: 2, optionLabel: null, parentLineId: "l1" },
          ],
        },
        {
          id: "pkg-2",
          recipientName: "Aunt Miriam",
          channel: "BULK_DELIVERY",
          deliveryDay: null,
          greeting: null,
          address: { line1: "40 Faraway Ln", line2: "Apt 2", city: "Monsey", region: "NY", postalCode: "10952" },
          lines: [{ orderLineId: "l2", productName: "Simple Box", qty: 1, optionLabel: null, parentLineId: null }],
        },
      ],
    },
  ],
};

const { pdfText } = await import("./lib/pdf-text.mts");

const slips = pdfText(await renderBatchPdf(fixture, "slips"));
check("slips render as a PDF", slips.startsWith("%PDF-"));
check("slips carry the order ref and both recipients", slips.includes("MM-TEST-0001") && slips.includes("Bubby Kohn") && slips.includes("Aunt Miriam"));
check("slips nest the add-on under its parent line", slips.includes("+2 x Ribbon"));
check(
  "smart punctuation is WinAnsi-sanitized, never a render crash",
  slips.includes("Happy Purim") && !slips.includes("“"),
);

const labels = pdfText(await renderBatchPdf(fixture, "labels"));
check("labels render as a PDF with recipients and addresses", labels.startsWith("%PDF-") && labels.includes("9 Hilltop Rd") && labels.includes("40 Faraway Ln"));
check("labels carry the channel + delivery day", labels.includes("Bulk delivery") && labels.includes("Purim Eve"));

const cards = pdfText(await renderBatchPdf(fixture, "cards"));
check("cards render as a PDF on card stock", cards.startsWith("%PDF-"));
check("cards include the greeted package and skip the greetingless one", cards.includes("For Bubby Kohn") && !cards.includes("For Aunt Miriam"));

const noGreetings: BatchPrintData = {
  ...fixture,
  orders: [{ ...fixture.orders[0], packages: fixture.orders[0].packages.map((pkg) => ({ ...pkg, greeting: null })) }],
};
const emptyCards = pdfText(await renderBatchPdf(noGreetings, "cards"));
check("a batch with zero greetings still renders a one-page placeholder", emptyCards.startsWith("%PDF-") && emptyCards.includes("No greeting cards"));

if (failures > 0) {
  console.error(`${failures} P7 check(s) failed`);
  process.exit(1);
}
console.log("All P7 checks passed");
