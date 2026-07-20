import Link from "next/link";
import { requirePermissionPage } from "@/lib/auth/current-user";
import { db } from "@/lib/db";
import { getOpenSeason } from "@/lib/season";
import { channelSummaries } from "@/lib/packages/board";
import { Card, CardTitle } from "@/components/ui/card";
import { FulfillmentActions } from "@/components/admin/fulfillment-actions";

const RECENT_ARTIFACTS = 30;

/** Fulfillment channel dashboard (R-072, R-073) + print production (UR-005). */
export default async function AdminFulfillmentPage() {
  await requirePermissionPage("fulfillment.manage");
  const season = await getOpenSeason();
  if (!season) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Fulfillment</h1>
        <p className="mt-3 text-sm text-muted">No season is open — open one under Settings first.</p>
      </div>
    );
  }

  const [channels, artifacts] = await Promise.all([
    channelSummaries(season.id),
    db.printArtifact.findMany({
      include: { printBatch: { select: { kind: true, runKey: true, createdAt: true } } },
      orderBy: { createdAt: "desc" },
      take: RECENT_ARTIFACTS,
    }),
  ]);
  const totalSavings = channels.reduce((sum, channel) => sum + channel.groupingSavings, 0);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Fulfillment</h1>
        <p className="text-sm text-muted">
          {season.name} ·{" "}
          <Link href="/admin/packages" className="text-brand hover:underline">
            Package board →
          </Link>
        </p>
      </div>

      <Card className="mb-4">
        <CardTitle className="mb-3">Channels</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3">Channel</th>
              <th className="py-2 pr-3">New</th>
              <th className="py-2 pr-3">Printed</th>
              <th className="py-2 pr-3">Packed</th>
              <th className="py-2 pr-3">Done</th>
              <th className="py-2 pr-3">Gifts</th>
              <th className="py-2 pr-3">Packages</th>
              <th className="py-2 pr-3">Boxes saved</th>
              <th className="py-2">Bulk action</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => (
              <tr key={channel.methodId} className="border-b border-border last:border-0">
                <td className="py-2 pr-3 font-medium">{channel.name}</td>
                <td className="py-2 pr-3">{channel.stageCounts.NEW}</td>
                <td className="py-2 pr-3">{channel.stageCounts.PRINTED}</td>
                <td className="py-2 pr-3">{channel.stageCounts.PACKED}</td>
                <td className="py-2 pr-3">{channel.stageCounts.SENT + channel.stageCounts.PICKED_UP}</td>
                <td className="py-2 pr-3">{channel.gifts}</td>
                <td className="py-2 pr-3">{channel.packages}</td>
                <td className="py-2 pr-3">{channel.groupingSavings}</td>
                <td className="py-2">
                  <FulfillmentActions
                    mode="channel"
                    methodId={channel.methodId}
                    methodKind={channel.kind}
                    stageCounts={channel.stageCounts}
                  />
                </td>
              </tr>
            ))}
            {channels.length === 0 && (
              <tr>
                <td colSpan={9} className="py-4 text-muted">
                  No packages yet — they appear when orders are finalized.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <p className="mt-3 text-xs text-muted">
          Production: gifts = individual gift lines; packages = physical boxes after grouping.
          Boxes saved = {totalSavings} shipments/deliveries avoided by combining gifts for the
          same recipient, address, method, and greeting.
        </p>
      </Card>

      <Card>
        <CardTitle className="mb-3">Print production</CardTitle>
        <p className="mb-3 text-sm text-muted">
          The nightly run bundles one PDF per filing group (package slips, labels, greeting cards
          on card stock) plus a packing slip per order — printing never changes a package&apos;s
          stage. Running it twice a day returns the same batch.
        </p>
        <FulfillmentActions mode="print" filingGroups={channels.map((channel) => channel.code)} />
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-muted">
              <th className="py-2 pr-3">Generated</th>
              <th className="py-2 pr-3">Batch</th>
              <th className="py-2 pr-3">Filing group</th>
              <th className="py-2 pr-3">Kind</th>
              <th className="py-2">PDF</th>
            </tr>
          </thead>
          <tbody>
            {artifacts.map((artifact) => (
              <tr key={artifact.id} className="border-b border-border last:border-0">
                <td className="py-1.5 pr-3 whitespace-nowrap text-muted">
                  {artifact.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                </td>
                <td className="py-1.5 pr-3 font-mono text-xs">{artifact.printBatch.runKey}</td>
                <td className="py-1.5 pr-3">{artifact.filingGroup}</td>
                <td className="py-1.5 pr-3">{artifact.kind.replace("_", " ").toLowerCase()}</td>
                <td className="py-1.5">
                  <a
                    href={`/api/admin/print-artifacts/${artifact.id}`}
                    target="_blank"
                    className="text-brand hover:underline"
                  >
                    Download
                  </a>
                </td>
              </tr>
            ))}
            {artifacts.length === 0 && (
              <tr>
                <td colSpan={5} className="py-4 text-muted">
                  No print batches yet — run tonight&apos;s batch above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
