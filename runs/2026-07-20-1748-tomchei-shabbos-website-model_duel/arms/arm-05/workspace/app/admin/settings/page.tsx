"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = { deliveryZipCodes: string[]; deliveryDates: string[]; storeStatus: "OPEN" | "CLOSED" };

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ deliveryZipCodes: [], deliveryDates: [], storeStatus: "CLOSED" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/admin/settings")
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => ok ? setSettings(body) : setMessage(body.error));
  }, []);

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/admin/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveryZipCodes: settings.deliveryZipCodes,
        deliveryDates: settings.deliveryDates,
        storeStatus: settings.storeStatus,
      }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Settings saved. Checkout ZIP rules update immediately." : body.error);
  }

  return (
    <>
      <p className="eyebrow">Settings</p>
      <h1>Store operations</h1>
      <div className="tabs"><a href="#orders">Orders</a><a href="#shipping">Shipping</a><a href="#email">Email</a><a href="#developer">Developer</a></div>
      <form className="card" onSubmit={saveSettings}>
        <section id="orders"><h2>Orders</h2><label>Store status<select onChange={(event) => setSettings({ ...settings, storeStatus: event.target.value as Settings["storeStatus"] })} value={settings.storeStatus}><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></label><p>Package types, pickup locations, and follow-up rules will be connected in later operations phases.</p></section>
        <section id="shipping"><h2>Shipping</h2><label>Delivery ZIP codes<textarea onChange={(event) => setSettings({ ...settings, deliveryZipCodes: event.target.value.split(/[\s,]+/).filter(Boolean) })} value={settings.deliveryZipCodes.join(", ")} /></label><label>Purim-week delivery dates<textarea onChange={(event) => setSettings({ ...settings, deliveryDates: event.target.value.split(/[\s,]+/).filter(Boolean) })} value={settings.deliveryDates.join(", ")} /></label><p>Checkout uses these ZIP and date rules now. Live carrier rates arrive in P8.</p></section>
        <section id="email"><h2>Email</h2><p>Newsletter preferences are live; campaigns and transactional email arrive in P11.</p></section>
        <section id="developer"><h2>Developer</h2><p>Health, environment validation, and the local test database are available now.</p></section>
        <button className="button" type="submit">Save settings</button>
      </form>
      {message && <p role="status">{message}</p>}
    </>
  );
}
