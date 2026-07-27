import { getStaffContext } from "@/lib/auth/current-user";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";

// Staff help center + guided tours (R-102). Static walkthroughs, one per
// working area, written for seasonal volunteers who see this app once a year.

const TOURS: { title: string; steps: string[] }[] = [
  {
    title: "Take an order at the counter (POS)",
    steps: [
      "Open Point of sale and search the customer by name, email, or phone — or add them new.",
      "Build the cart exactly like the web store: pick products, assign each line a recipient.",
      "Checkout re-prices on the server. Take cash or check and post it right there; the order finalizes and packages appear on the board.",
    ],
  },
  {
    title: "Work the package board",
    steps: [
      "Packages groups everything by stage: NEW → PRINTED → PACKED → SENT (or PICKED_UP).",
      "Split a package when one recipient's items ship separately; regroup to merge them back.",
      "Never move a package backward. If two people grab the same package, the second save is refused — refresh and retry.",
    ],
  },
  {
    title: "Run the nightly print batch",
    steps: [
      "Fulfillment → Print production → run the nightly batch. It prints only packages nobody printed yet, once per day.",
      "PDFs file by fulfillment method. Reprints go through the same page and never change a package's stage.",
    ],
  },
  {
    title: "Build and run delivery routes",
    steps: [
      "Routes → new route: pick delivery packages, the builder orders stops nearest-first.",
      "Send the driver a magic link (optionally PIN-locked). The driver taps stops off; the printed sheet is the fallback.",
      "A wrong-address package: switch its method or reroute it — money never changes from a reroute.",
    ],
  },
  {
    title: "Close out the season (reports & exports)",
    steps: [
      "Reports: season totals, per-method drill-downs, and the shipping-margin reconciliation.",
      "Exports: download deliveries, year-end orders, item sales, and lapsed customers as CSV — every download is audited.",
      "Run Stripe reconciliation after big days; resolve any flags it raises.",
    ],
  },
  {
    title: "Import last year's data (managers)",
    steps: [
      "Import → Legacy migration: paste the old system's export and dry-run it. Read the report — nothing is written yet.",
      "Commit runs in stages (catalog → customers → addresses → orders); if it's interrupted, commit the same file again and it resumes.",
      "Work the address review queue afterward: those are entries the cleanup pass couldn't normalize confidently.",
    ],
  },
];

export default async function HelpPage() {
  const staff = await getStaffContext();
  if (!staff) redirect("/login?next=/admin/help");

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold mb-1">Help center</h1>
        <p className="text-sm text-muted">
          Guided walkthroughs for each working area. Ask a manager for anything not covered here.
        </p>
      </div>
      {TOURS.map((tour) => (
        <Card key={tour.title}>
          <CardTitle>{tour.title}</CardTitle>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {tour.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </Card>
      ))}
    </div>
  );
}
