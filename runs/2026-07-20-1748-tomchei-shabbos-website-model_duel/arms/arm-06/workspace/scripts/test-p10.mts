// Unit checks for P10 pure helpers: the repeat-confirm decision applicator
// (keep/remove/swap, recipient removal fallout, qty overrides) and the staff
// one-click auto-confirmer. DB-backed P10 behavior (chains, plans, drafts,
// wizard, flip, bulk history, legacy import) lives in test-p10-domain.mts.

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

const { applyConfirmations, autoConfirmPlan } = await import("../lib/repeat/create");

type Plan = Parameters<typeof applyConfirmations>[0];

const autoLine = {
  sourceLineId: "l1",
  sourceName: "Classic Box",
  sourceUnitPriceCents: 1000,
  sourceOptionLabel: null,
  qty: 2,
  sourceRecipientId: "r1",
  status: "auto" as const,
  targetProductId: "p1",
  targetName: "Classic Box",
  targetUnitPriceCents: 1100,
  optionValueId: null,
  optionLabel: null,
  notes: [],
  addOns: [
    {
      sourceLineId: "a1",
      sourceName: "Card",
      qty: 1,
      status: "auto" as const,
      addOnId: "addon-1",
      unitPriceCents: 150,
      note: null,
    },
  ],
};

const unmappedLine = {
  sourceLineId: "l2",
  sourceName: "Old Candy",
  sourceUnitPriceCents: 500,
  sourceOptionLabel: null,
  qty: 1,
  sourceRecipientId: "r2",
  status: "unmapped" as const,
  targetProductId: null,
  targetName: null,
  targetUnitPriceCents: null,
  optionValueId: null,
  optionLabel: null,
  notes: ["discontinued with no replacement mapped"],
  suggestions: [{ productId: "p9", name: "New Candy", priceCents: 550, priceDeltaCents: 50 }],
  addOns: [
    {
      sourceLineId: "a2",
      sourceName: "Ribbon",
      qty: 1,
      status: "dropped" as const,
      addOnId: null,
      unitPriceCents: null,
      note: "parent line is unmapped",
    },
  ],
};

function makePlan(): Plan {
  return {
    sourceOrderId: "o1",
    sourceOrderNumber: 42,
    sourceSeasonName: "Purim 2026",
    targetSeasonId: "s2",
    targetSeasonName: "Purim 2027",
    lines: [structuredClone(autoLine), structuredClone(unmappedLine)],
    recipients: [
      {
        sourceRecipientId: "r1",
        name: "Bubby",
        line1: "9 Hilltop Rd",
        line2: null,
        city: "Lakewood",
        region: "NJ",
        postalCode: "08701",
        country: "US",
        matchedAddressId: "addr-1",
        greeting: "From the Cohens",
      },
      {
        sourceRecipientId: "r2",
        name: "Zeidy",
        line1: "1 Main St",
        line2: null,
        city: "Monsey",
        region: "NY",
        postalCode: "10952",
        country: "US",
        matchedAddressId: null,
        greeting: "",
      },
    ],
    unmappedCount: 1,
  };
}

function throwsDomainRule(run: () => unknown): boolean {
  try {
    run();
    return false;
  } catch (error) {
    return (error as Error)?.name === "DomainRuleError";
  }
}

// --- unmapped discipline ------------------------------------------------------
check(
  "an unmapped line with no swap decision refuses (pick-or-remove rule)",
  throwsDomainRule(() =>
    applyConfirmations(makePlan(), {
      sourceOrderId: "o1",
      lines: [{ sourceLineId: "l1", action: "keep" }],
      recipients: [],
    }),
  ),
);
check(
  "a swap without a target product refuses",
  throwsDomainRule(() =>
    applyConfirmations(makePlan(), {
      sourceOrderId: "o1",
      lines: [
        { sourceLineId: "l1", action: "keep" },
        { sourceLineId: "l2", action: "swap" },
      ],
      recipients: [],
    }),
  ),
);

// --- happy path -----------------------------------------------------------------
const confirmed = applyConfirmations(makePlan(), {
  sourceOrderId: "o1",
  lines: [
    { sourceLineId: "l1", action: "keep" },
    { sourceLineId: "l2", action: "swap", targetProductId: "p9" },
  ],
  recipients: [
    { sourceRecipientId: "r1", action: "keep", greeting: "Edited greeting" },
    { sourceRecipientId: "r2", action: "keep" },
  ],
});
const confirmedProductLines = confirmed.lines.filter((line) => line.productId);
check(
  "keep + swap produce product lines for both targets",
  confirmedProductLines.length === 2 &&
    confirmedProductLines.some((line) => line.productId === "p1") &&
    confirmedProductLines.some((line) => line.productId === "p9"),
);
check(
  "the auto line's add-on rides along under a FRESH parent id (never the source row id)",
  confirmed.lines.some(
    (line) =>
      line.addOnId === "addon-1" &&
      line.parentLineId !== undefined &&
      line.parentLineId !== "l1" &&
      confirmedProductLines.some((parent) => parent.id === line.parentLineId),
  ),
);
check("the dropped add-on of the swapped line does not carry over", !confirmed.lines.some((line) => line.addOnId && line.addOnId !== "addon-1"));
check(
  "summary records the swap and the keep",
  confirmed.summary.kept.includes("Classic Box") &&
    confirmed.summary.swapped.some((swap) => swap.from === "Old Candy"),
);
check(
  "recipient greeting override + book link land in the draft input",
  confirmed.recipients.some((r) => r.clientId === "r1" && r.greeting === "Edited greeting" && r.addressId === "addr-1"),
);
check(
  "the swapped line keeps its recipient assignment",
  confirmedProductLines.find((line) => line.productId === "p9")?.recipientClientId === "r2",
);

// --- removals ---------------------------------------------------------------------
const removedLine = applyConfirmations(makePlan(), {
  sourceOrderId: "o1",
  lines: [
    { sourceLineId: "l1", action: "keep" },
    { sourceLineId: "l2", action: "remove" },
  ],
  recipients: [],
});
check(
  "removing the unmapped line is legal and is summarized",
  removedLine.lines.filter((line) => line.productId).length === 1 && removedLine.summary.removed.includes("Old Candy"),
);
check(
  "removing every line refuses (nothing to repeat)",
  throwsDomainRule(() =>
    applyConfirmations(makePlan(), {
      sourceOrderId: "o1",
      lines: [
        { sourceLineId: "l1", action: "remove" },
        { sourceLineId: "l2", action: "remove" },
      ],
      recipients: [],
    }),
  ),
);
const removedRecipient = applyConfirmations(makePlan(), {
  sourceOrderId: "o1",
  lines: [
    { sourceLineId: "l1", action: "keep" },
    { sourceLineId: "l2", action: "swap", targetProductId: "p9" },
  ],
  recipients: [
    { sourceRecipientId: "r1", action: "keep" },
    { sourceRecipientId: "r2", action: "remove" },
  ],
});
check(
  "a removed recipient unassigns its lines instead of dangling",
  removedRecipient.recipients.length === 1 &&
    removedRecipient.lines.filter((line) => line.productId).every((line) =>
      line.productId === "p9" ? line.recipientClientId === null : true,
    ),
);

// --- qty overrides ------------------------------------------------------------------
check(
  "a qty override lands on the kept line",
  applyConfirmations(makePlan(), {
    sourceOrderId: "o1",
    lines: [
      { sourceLineId: "l1", action: "keep", qty: 5 },
      { sourceLineId: "l2", action: "remove" },
    ],
    recipients: [],
  }).lines.find((line) => line.productId === "p1")?.qty === 5,
);
check(
  "a non-positive qty refuses",
  throwsDomainRule(() =>
    applyConfirmations(makePlan(), {
      sourceOrderId: "o1",
      lines: [
        { sourceLineId: "l1", action: "keep", qty: 0 },
        { sourceLineId: "l2", action: "remove" },
      ],
      recipients: [],
    }),
  ),
);

// --- staff one-click auto-confirm ----------------------------------------------------
const auto = autoConfirmPlan(makePlan());
check(
  "auto-confirm keeps mapped lines and removes dead ends",
  auto.lines.find((line) => line.sourceLineId === "l1")?.action === "keep" &&
    auto.lines.find((line) => line.sourceLineId === "l2")?.action === "remove",
);
check(
  "auto-confirm keeps every recipient",
  auto.recipients.every((recipient) => recipient.action === "keep") && auto.recipients.length === 2,
);
check(
  "auto-confirm on a fully dead order refuses at apply time",
  throwsDomainRule(() =>
    applyConfirmations(
      { ...makePlan(), lines: [structuredClone(unmappedLine)], unmappedCount: 1 },
      autoConfirmPlan({ ...makePlan(), lines: [structuredClone(unmappedLine)], unmappedCount: 1 }),
    ),
  ),
);

if (failures > 0) {
  console.error(`${failures} P10 unit check(s) failed`);
  process.exit(1);
}
console.log("P10 unit checks passed");
