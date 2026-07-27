"use client";

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/foundation";

type Performance = { season: string; year: number; orders: number; grossCents: number; fulfillmentCents: number; paidOrders: number };
type Margin = { shipmentId: string; orderNumber: number | null; season: string; carrier: string; chargedCents: number; paidCents: number; marginCents: number };
type MarginTotal = { season: string; chargedCents: number; paidCents: number; marginCents: number };
type ExportAudit = { id: string; subjectId: string | null; actorId: string | null; details: { bytes?: number }; createdAt: string };
type AddressReview = { id: string; recipientName: string; line1: string; city: string; state: string; postalCode: string; customer: { firstName: string; lastName: string; emailNormalized: string | null } };

export default function ReportsPage() {
  const [performance, setPerformance] = useState<Performance[]>([]);
  const [margins, setMargins] = useState<Margin[]>([]);
  const [marginTotals, setMarginTotals] = useState<MarginTotal[]>([]);
  const [exports, setExports] = useState<ExportAudit[]>([]);
  const [addressReviews, setAddressReviews] = useState<AddressReview[]>([]);
  const [message, setMessage] = useState("");
  const [legacyCsv, setLegacyCsv] = useState("kind,year,email,first_name,last_name,sku,product_name,price_cents,total_cents,order_number,recipient_name,line1,city,state,postal_code\ncustomer,,legacy@example.test,Legacy,Customer,,,,,,,,,,\nproduct,2025,,,,LEGACY-BOX,Legacy Box,4200,,,,,,,\norder,2025,legacy@example.test,,,LEGACY-BOX,,,4200,1001,Legacy Customer,1 Archive Way,Brooklyn,NY,11201");
  const [legacyBatchId, setLegacyBatchId] = useState("");

  async function load() {
    const response = await fetch("/api/admin/reports");
    const body = await response.json();
    if (!response.ok) return setMessage(body.error ?? "Reports could not be loaded.");
    setPerformance(body.performance);
    setMargins(body.margins.packages);
    setMarginTotals(Object.values(body.margins.totals));
    setExports(body.exports);
    setAddressReviews(body.addressReviews);
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/reports", { signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setMessage(body.error ?? "Reports could not be loaded.");
          return;
        }
        setPerformance(body.performance);
        setMargins(body.margins.packages);
        setMarginTotals(Object.values(body.margins.totals));
        setExports(body.exports);
        setAddressReviews(body.addressReviews);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Reports could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  async function post(action: Record<string, unknown>) {
    const response = await fetch("/api/admin/reports", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error ?? "The request could not finish.");
      return null;
    }
    return body;
  }

  async function reconcile() {
    const body = await post({ action: "reconcile" });
    if (body) setMessage(`Reconciliation flagged ${body.orphaned.length} orphaned PaymentIntent${body.orphaned.length === 1 ? "" : "s"}.`);
  }

  async function stageLegacyImport() {
    const body = await post({ action: "stage_legacy_import", csv: legacyCsv });
    if (body) {
      setLegacyBatchId(body.batchId);
      setMessage(`Dry-run staged ${body.accepted} rows with ${body.errors.length} error(s).`);
    }
  }

  async function commitLegacyImport() {
    const body = await post({ action: "commit_legacy_import", batchId: legacyBatchId });
    if (body) {
      setLegacyBatchId("");
      setMessage(`Imported ${body.imported} legacy rows atomically.`);
      await load();
    }
  }

  async function approveLegacyAddress(addressId: string) {
    const body = await post({ action: "approve_legacy_address", addressId });
    if (body) {
      setMessage("Legacy address approved.");
      await load();
    }
  }

  return (
    <>
      <p className="eyebrow">Reporting & launch readiness</p>
      <h1>Season closeout desk</h1>
      <p className="lead">Reconcile payments, inspect the shipping spread, export audited records, and stage legacy data before opening the next season.</p>
      <section className="card ops-list">
        <h2>Multi-season performance</h2>
        {performance.map((season) => <div className="ops-row" key={season.year}><span>{season.season} · {season.orders} finalized orders · {season.paidOrders} paid</span><span>{formatMoney(season.grossCents)} gross · {formatMoney(season.fulfillmentCents)} fulfillment</span></div>)}
        <p><a className="button secondary" href="/api/admin/reports?export=year_metrics">Export year metrics CSV</a><a className="button secondary" href="/api/admin/reports?export=item_sales">Export item sales CSV</a></p>
      </section>
      <section className="card ops-list">
        <h2>Shipping-margin reconciliation</h2>
        {marginTotals.map((total) => <div className="ops-row" key={total.season}><span>{total.season} season total</span><span>Charged {formatMoney(total.chargedCents)} · paid {formatMoney(total.paidCents)} · margin {formatMoney(total.marginCents)}</span></div>)}
        {margins.length === 0 ? <p>No purchased shipping labels are ready to reconcile.</p> : margins.map((margin) => <div className="ops-row" key={margin.shipmentId}><span>{margin.season} · order #{margin.orderNumber ?? "pending"} · {margin.carrier}</span><span>Charged {formatMoney(margin.chargedCents)} · paid {formatMoney(margin.paidCents)} · margin {formatMoney(margin.marginCents)}</span></div>)}
        <p><a className="button secondary" href="/api/admin/reports?export=shipping_margin">Export shipping margins CSV</a><button className="button" onClick={() => void reconcile()} type="button">Run Stripe reconciliation</button></p>
      </section>
      <section className="card ops-list">
        <h2>Export audit history</h2>
        {exports.length === 0 ? <p>No reports have been exported yet.</p> : exports.map((entry) => <div className="ops-row" key={entry.id}><span>{entry.subjectId ?? "report"} · {entry.actorId ?? "system"}</span><span>{entry.details.bytes ?? 0} bytes · {new Date(entry.createdAt).toLocaleString()}</span></div>)}
      </section>
      <section className="card">
        <h2>Legacy migration</h2>
        <p>CSV entity map: customer email/phone → customer; year + SKU → product; order rows → finalized orders, addresses, and repeat-ready packages.</p>
        <textarea aria-label="Legacy import CSV" onChange={(event) => setLegacyCsv(event.target.value)} value={legacyCsv} />
        <p><button className="button" onClick={() => void stageLegacyImport()} type="button">Dry-run legacy import</button>{legacyBatchId && <button className="button secondary" onClick={() => void commitLegacyImport()} type="button">Commit staged import</button>}</p>
      </section>
      <section className="card ops-list">
        <h2>Legacy address review queue</h2>
        {addressReviews.length === 0 ? <p>No imported addresses need review.</p> : addressReviews.map((address) => <div className="ops-row" key={address.id}><span>{address.recipientName} · {address.line1}, {address.city}, {address.state} {address.postalCode} · {address.customer.emailNormalized ?? `${address.customer.firstName} ${address.customer.lastName}`}</span><button className="button secondary" onClick={() => void approveLegacyAddress(address.id)} type="button">Approve address</button></div>)}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
