"use client";

import { useEffect, useState } from "react";

type Shipment = {
  id: string;
  carrier: string | null;
  service: string | null;
  chargedCents: number | null;
  labelCostCents: number | null;
  marginCents: number | null;
  labelUrl: string | null;
  trackingNumber: string | null;
  trackingStatus: string | null;
  labelVoidedAt: string | null;
};

type Order = {
  id: string;
  draftReference: string;
  orderNumber: number | null;
  packages: Array<{
    id: string;
    recipientName: string;
    status: string;
    fulfillmentMethod: { code: string; name: string };
    shipmentBoxes: Shipment[];
  }>;
};

type OrderDetailProps = { params: Promise<{ orderId: string }> };

export default function OrderDetailPage({ params }: OrderDetailProps) {
  const [order, setOrder] = useState<Order | null>(null);
  const [message, setMessage] = useState("Loading order…");

  async function orderId() {
    return (await params).orderId;
  }

  async function load() {
    const response = await fetch(`/api/admin/orders/${await orderId()}`);
    const body = await response.json() as { order?: Order; error?: string };
    if (!response.ok || !body.order) {
      setMessage(body.error ?? "Order could not be loaded.");
      return;
    }
    setOrder(body.order);
    setMessage("");
  }

  async function runShippingAction(packageId: string, action: "create_label" | "void_label" | "refresh_tracking" | "validate_address") {
    const response = await fetch(`/api/admin/packages/${packageId}/shipping`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const body = await response.json() as { error?: string };
    if (!response.ok) {
      setMessage(body.error ?? "Shipping action could not be completed.");
      return;
    }
    setMessage(action === "validate_address" ? "Shippo accepted the package address." : "Shipping record updated.");
    await load();
  }

  useEffect(() => {
    let isCurrent = true;
    void params.then(async ({ orderId: initialOrderId }) => {
      const response = await fetch(`/api/admin/orders/${initialOrderId}`);
      const body = await response.json() as { order?: Order; error?: string };
      if (!isCurrent) return;
      if (!response.ok || !body.order) {
        setMessage(body.error ?? "Order could not be loaded.");
        return;
      }
      setOrder(body.order);
      setMessage("");
    });
    return () => {
      isCurrent = false;
    };
  }, [params]);

  if (!order) return <main><h1>Order detail</h1><p role="status">{message}</p></main>;
  return (
    <main>
      <p className="eyebrow">Order detail</p>
      <h1>{order.orderNumber ? `Order #${order.orderNumber}` : order.draftReference}</h1>
      <p>Manage shipping labels without marking a package sent.</p>
      <section className="card ops-list">
        <h2>Packages</h2>
        {order.packages.map((packageRecord) => {
          const shipment = packageRecord.shipmentBoxes.find((candidate) => !candidate.labelVoidedAt);
          return (
            <div className="ops-row" key={packageRecord.id}>
              <span>{packageRecord.recipientName} · {packageRecord.fulfillmentMethod.name} · {packageRecord.status}</span>
              {packageRecord.fulfillmentMethod.code === "SHIP" && (
                <span>
                  <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "validate_address")} type="button">Validate address</button>
                  {shipment
                    ? <>
                      {shipment.labelUrl && <a className="button secondary" href={shipment.labelUrl} rel="noopener noreferrer" target="_blank">Open carrier label</a>}
                      <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "refresh_tracking")} type="button">Refresh tracking</button>
                      {packageRecord.status !== "SENT" && <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "void_label")} type="button">Void label</button>}
                    </>
                    : <button className="button secondary" onClick={() => void runShippingAction(packageRecord.id, "create_label")} type="button">Buy cheapest label</button>}
                </span>
              )}
            </div>
          );
        })}
      </section>
      {message && <p className="notice" role="status">{message}</p>}
    </main>
  );
}
