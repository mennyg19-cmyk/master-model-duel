import type { Metadata } from "next";
import { requireStaff } from "@/lib/auth";

export const metadata: Metadata = { title: "Help center" };
export const dynamic = "force-dynamic";

// R-102: staff help center + guided tours. Each tour is the exact click-path
// for one workflow — written against the live screens, not a video that rots.
const TOURS: { title: string; intro: string; steps: string[] }[] = [
  {
    title: "Take a counter order (POS)",
    intro: "For walk-in or phone orders with cash, check, or comp payment.",
    steps: [
      "Open POS from the sidebar and start a new order.",
      "Find or create the customer — dedupe matches on email or phone, so search before creating.",
      "Add packages: pick products, options, and add-ons per recipient.",
      "Choose each recipient's fulfillment: pickup, delivery, or carrier shipping.",
      "Post the payment (cash/check/comp) — the order finalizes and gets its order number.",
      "Hand the customer their wire-format reference (MM-…).",
    ],
  },
  {
    title: "Work the package board",
    intro: "Daily packing flow from NEW to out-the-door.",
    steps: [
      "Open Packages — the board groups everything by stage.",
      "Print the nightly batch (or wait for the 6am cron): slips file packages into groups.",
      "Mark packages PRINTED as slips come off the printer, PACKED as boxes close.",
      "Deliveries move to SENT when the route leaves; pickups wait for the customer.",
      "Anything wrong? Open the package — regroup or reroute from there (audited).",
    ],
  },
  {
    title: "Run a delivery route",
    intro: "Day-of driver flow with the magic link.",
    steps: [
      "Open Routes and build a route from the day's delivery packages.",
      "Create the driver link and send it — no driver account needed.",
      "The driver taps Start; day-of notifications go out automatically.",
      "Stops are marked delivered from the driver's phone; the board updates live.",
      "When every stop is done the link dies. Reroute stragglers from the package page.",
    ],
  },
  {
    title: "Close the books (reports, exports, reconciliation)",
    intro: "Season-end money workflow.",
    steps: [
      "Open Reports — check multi-season performance and the shipping-margin view against your own ledger.",
      "Open Reconciliation and run a pass — findings flag Stripe intents with no order and orders with no intent.",
      "Resolve findings, then rerun: a clean pass shows zero open findings and never duplicates adjustments.",
      "Open the Export center and download year-end + year-metrics CSVs for the accountant.",
      "Every export and run lands in the audit history on the same page.",
    ],
  },
  {
    title: "Import last year's data",
    intro: "Year-one migration from the old system (see docs/LEGACY-ENTITY-MAP.md for the column map).",
    steps: [
      "Open Imports and dry-run the legacy customers CSV — nothing writes; study the verdict ledger.",
      "Fix what the ledger flags (malformed contacts, ambiguous matches), then stage for real and commit.",
      "Repeat for legacy products, then legacy orders — orders claim clean sequential numbers; the old numbers stay on legacyRef.",
      "Open a customer with a flagged address book and finish the cleanup pass (merge dupes, confirm flags).",
      "Spot-check: repeat an imported order from its detail page — unmapped products route to the review page.",
    ],
  },
  {
    title: "Reset the test environment",
    intro: "Between rehearsal acts on the test deployment.",
    steps: [
      "Open Test console (managers only; production refuses outright).",
      "Clear removes just the transactional trail; Wipe + reseed restores a clean baseline season.",
      "The fuchsia TEST ENVIRONMENT banner on every screen confirms you are not on live.",
    ],
  },
];

export default async function AdminHelpPage() {
  await requireStaff();

  return (
    <div>
      <h1 className="text-2xl font-semibold">Help center</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-500">
        Guided tours for the daily workflows. Every step names the real screen — follow them top to
        bottom the first time, then they stay as checklists.
      </p>

      <div className="mt-6 grid gap-5 lg:grid-cols-2" data-help-tours>
        {TOURS.map((tour) => (
          <section key={tour.title} className="rounded-lg border border-stone-200 bg-white p-5">
            <h2 className="font-semibold">{tour.title}</h2>
            <p className="mt-1 text-sm text-stone-600">{tour.intro}</p>
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-stone-700">
              {tour.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
