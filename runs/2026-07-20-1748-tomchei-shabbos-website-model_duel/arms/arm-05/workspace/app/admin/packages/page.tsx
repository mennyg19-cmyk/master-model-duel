"use client";

import { useEffect, useState } from "react";
import { formatEnumLabel, formatOrderLabel, packageItemCount } from "@/lib/packages";

type PackageRecord = {
  id: string;
  version: number;
  status: "NEW" | "PRINTED" | "PACKED" | "SENT" | "PICKED_UP";
  recipientName: string;
  greeting: string;
  order: { id: string; orderNumber: number | null; draftReference: string };
  fulfillmentMethod: { code: string; name: string };
  lines: { quantity: number }[];
  shipmentBoxes: { externalLabelId: string | null; carrier: string | null; service: string | null; labelUrl: string | null; trackingNumber: string | null; trackingStatus: string | null }[];
};
type Artifact = { id: string; filingGroup: string; kind: string };
type Dashboard = {
  packages: PackageRecord[];
  total: number;
  page: number;
  pageSize: number;
  channels: { code: string; packageCount: number; productionUnits: number }[];
  productionUnits: number;
  consolidatedItems: number;
};

export default function PackagesPage() {
  const [packages, setPackages] = useState<PackageRecord[]>([]);
  const [channels, setChannels] = useState<{ code: string; packageCount: number; productionUnits: number }[]>([]);
  const [summary, setSummary] = useState({ productionUnits: 0, consolidatedItems: 0 });
  const [pagination, setPagination] = useState({ page: 1, pageSize: 100, total: 0 });
  const [selected, setSelected] = useState<string[]>([]);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [message, setMessage] = useState("");

  function applyDashboard(dashboard: Dashboard) {
    setPackages(dashboard.packages);
    setChannels(dashboard.channels);
    setSummary({ productionUnits: dashboard.productionUnits, consolidatedItems: dashboard.consolidatedItems });
    setPagination({ page: dashboard.page, pageSize: dashboard.pageSize, total: dashboard.total });
  }

  async function load(page = pagination.page, signal?: AbortSignal) {
    const response = await fetch(`/api/admin/packages?page=${page}`, { signal });
    const body = await response.json();
    if (!response.ok) {
      if (!signal?.aborted) setMessage(body.error ?? "Packages could not be loaded.");
      return;
    }
    if (!signal?.aborted) applyDashboard(body);
  }

  async function postJson(url: string, action: Record<string, unknown>) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action),
    });
    const body = await response.json();
    if (!response.ok) {
      setMessage(body.error);
      return { ok: false, body };
    }
    return { ok: true, body };
  }

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/packages?page=1", { signal: controller.signal })
      .then(async (response) => ({ response, body: await response.json() as Dashboard & { error?: string } }))
      .then(({ response, body }) => {
        if (controller.signal.aborted) return;
        if (!response.ok) {
          setMessage(body.error ?? "Packages could not be loaded.");
          return;
        }
        applyDashboard(body);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Packages could not be loaded.");
      });
    return () => controller.abort();
  }, []);

  async function runPackageAction(action: Record<string, unknown>) {
    const response = await postJson("/api/admin/packages", action);
    if (!response.ok) return;
    setMessage("Package board updated.");
    setSelected([]);
    await load();
  }

  async function runPrintAction(action: Record<string, unknown>) {
    const response = await postJson("/api/admin/print", action);
    if (!response.ok) return;
    if (response.body.batch) setArtifacts(response.body.batch.artifacts);
    setMessage(response.body.created === false ? "Tonight's batch already exists; no artifacts were regenerated." : "Nightly print batch is ready.");
  }

  async function runShippingAction(packageId: string, action: "create_label" | "void_label" | "refresh_tracking" | "validate_address") {
    const response = await postJson(`/api/admin/packages/${packageId}/shipping`, { action });
    if (!response.ok) return;
    setMessage(action === "validate_address" ? "Shippo accepted the package address." : "Shipping record updated.");
    await load();
  }

  function toggle(packageId: string) {
    setSelected((current) => current.includes(packageId) ? current.filter((id) => id !== packageId) : [...current, packageId]);
  }

  const selectedPackages = packages.filter((packageRecord) => selected.includes(packageRecord.id));
  const bulkVersions = Object.fromEntries(selectedPackages.map((packageRecord) => [packageRecord.id, packageRecord.version]));

  return (
    <>
      <p className="eyebrow">Package engine</p>
      <h1>Fulfillment board</h1>
      <p className="lead">Materialize paid orders, track each physical package, and print filing groups without changing shipment status.</p>
      <div className="grid">
        <section className="card"><h2>{summary.productionUnits}</h2><p>Items in active production</p></section>
        <section className="card"><h2>{summary.consolidatedItems}</h2><p>Additional items consolidated into packages</p></section>
        {channels.map((channel) => <section className="card" key={channel.code}><h2>{channel.packageCount}</h2><p>{channel.code} packages · {channel.productionUnits} items</p></section>)}
      </div>
      <section className="card ops-list">
        <h2>Batch printing</h2>
        <button className="button" onClick={() => void runPrintAction({ action: "nightly_batch" })} type="button">Build tonight&apos;s slips, labels, and cards</button>
        {artifacts.map((artifact) => (
          <div className="ops-row" key={artifact.id}>
            <span>{formatEnumLabel(artifact.filingGroup)} · {formatEnumLabel(artifact.kind)}</span>
            <span>
              <a className="button secondary" href={`/api/admin/print?artifactId=${artifact.id}`} rel="noopener noreferrer" target="_blank">Open PDF</a>
              <button className="button secondary" onClick={() => void runPrintAction({ action: "reprint_artifact", artifactId: artifact.id })} type="button">Record reprint</button>
            </span>
          </div>
        ))}
      </section>
      <section className="card ops-list">
        <h2>Package board</h2>
        <p>Select two new packages from one order to regroup them, or select any eligible packages for a bulk stage change.</p>
        <p>
          Showing {packages.length ? (pagination.page - 1) * pagination.pageSize + 1 : 0}–{Math.min(pagination.page * pagination.pageSize, pagination.total)} of {pagination.total} packages
          <button className="button secondary" disabled={pagination.page === 1} onClick={() => void load(pagination.page - 1)} type="button">Previous</button>
          <button className="button secondary" disabled={pagination.page * pagination.pageSize >= pagination.total} onClick={() => void load(pagination.page + 1)} type="button">Next</button>
        </p>
        <p>
          <button className="button secondary" disabled={selected.length < 2} onClick={() => void runPackageAction({ action: "regroup", packageIds: selected, versions: bulkVersions })} type="button">Regroup selected</button>
          <button className="button secondary" disabled={!selected.length} onClick={() => void runPackageAction({ action: "bulk_status", packageIds: selected, versions: bulkVersions, status: "PRINTED" })} type="button">Mark selected printed</button>
          <button className="button secondary" disabled={!selected.length} onClick={() => void runPackageAction({ action: "bulk_status", packageIds: selected, versions: bulkVersions, status: "PACKED" })} type="button">Mark selected packed</button>
          <button className="button secondary" disabled={!selected.length} onClick={() => void runPackageAction({ action: "bulk_status", packageIds: selected, versions: bulkVersions, status: "SENT" })} type="button">Mark selected sent</button>
          <button className="button secondary" disabled={!selected.length} onClick={() => void runPackageAction({ action: "bulk_status", packageIds: selected, versions: bulkVersions, status: "PICKED_UP" })} type="button">Mark selected picked up</button>
        </p>
        {packages.map((packageRecord) => (
          <div className="ops-row" key={packageRecord.id}>
            <label className="check-row"><input checked={selected.includes(packageRecord.id)} onChange={() => toggle(packageRecord.id)} type="checkbox" />{packageRecord.recipientName}</label>
            <span>
              {formatOrderLabel(packageRecord.order)} · {packageRecord.fulfillmentMethod.name} · {packageItemCount(packageRecord.lines)} item(s) · {packageRecord.status}
              <a className="button secondary" href={`/api/admin/print?orderId=${packageRecord.order.id}`} rel="noopener noreferrer" target="_blank">Packing slip</a>
              {packageRecord.status === "NEW" && <button className="button secondary" onClick={() => void runPackageAction({ action: "split", packageId: packageRecord.id, version: packageRecord.version })} type="button">Split</button>}
              {packageRecord.status === "NEW" && <button className="button secondary" onClick={() => void runPackageAction({ action: "advance", packageId: packageRecord.id, version: packageRecord.version, status: "PRINTED" })} type="button">Print</button>}
              {["NEW", "PRINTED"].includes(packageRecord.status) && <button className="button secondary" onClick={() => void runPackageAction({ action: "advance", packageId: packageRecord.id, version: packageRecord.version, status: "PACKED" })} type="button">Pack</button>}
              {["NEW", "PRINTED", "PACKED"].includes(packageRecord.status) && <button className="button secondary" onClick={() => void runPackageAction({ action: "advance", packageId: packageRecord.id, version: packageRecord.version, status: "SENT" })} type="button">Send</button>}
              {["NEW", "PRINTED", "PACKED"].includes(packageRecord.status) && <button className="button secondary" onClick={() => void runPackageAction({ action: "advance", packageId: packageRecord.id, version: packageRecord.version, status: "PICKED_UP" })} type="button">Pick up</button>}
              {packageRecord.fulfillmentMethod.code === "SHIP" && (
                <>
                  <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "validate_address")} type="button">Validate address</button>
                  {packageRecord.shipmentBoxes[0]
                    ? <>
                      {packageRecord.shipmentBoxes[0].labelUrl && <a className="button secondary" href={packageRecord.shipmentBoxes[0].labelUrl} rel="noopener noreferrer" target="_blank">Open carrier label</a>}
                      <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "refresh_tracking")} type="button">Refresh tracking</button>
                      {packageRecord.status !== "SENT" && <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "void_label")} type="button">Void label</button>}
                    </>
                    : <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "create_label")} type="button">Buy cheapest label</button>}
                </>
              )}
            </span>
          </div>
        ))}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </>
  );
}
