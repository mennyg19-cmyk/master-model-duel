"use client";

import { FormEvent, useEffect, useState } from "react";

type Settings = { deliveryZipCodes: string[]; deliveryDates: string[]; storeStatus: "OPEN" | "CLOSED" };
type Campaign = { id: string; name: string; subject: string; body: string; status: string };
type EmailHub = {
  campaigns: Campaign[];
  pendingOutbox: number;
  lists: Array<{ id: string; name: string; _count: { members: number } }>;
  templates: Array<{ id: string; key: string; subject: string; branding: Record<string, string> }>;
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({ deliveryZipCodes: [], deliveryDates: [], storeStatus: "CLOSED" });
  const [emailHub, setEmailHub] = useState<EmailHub>({ campaigns: [], pendingOutbox: 0, lists: [], templates: [] });
  const [campaign, setCampaign] = useState({ name: "", subject: "", body: "" });
  const [testRecipient, setTestRecipient] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    void fetch("/api/admin/settings")
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => ok ? setSettings(body) : setMessage(body.error));
    void fetch("/api/admin/email")
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => ok ? setEmailHub(body) : setMessage(body.error));
  }, []);

  async function loadEmailHub() {
    const response = await fetch("/api/admin/email");
    const body = await response.json();
    if (response.ok) setEmailHub(body);
    else setMessage(body.error);
  }

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

  async function createCampaign() {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "create_campaign", ...campaign }),
    });
    const body = await response.json();
    if (!response.ok) return setMessage(body.error);
    setCampaign({ name: "", subject: "", body: "" });
    setMessage("Campaign draft saved.");
    await loadEmailHub();
  }

  async function runCampaign(action: "send_campaign" | "test_campaign", campaignId: string) {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(action === "test_campaign"
        ? { action, campaignId, recipient: testRecipient }
        : { action, campaignId }),
    });
    const body = await response.json();
    setMessage(response.ok ? action === "test_campaign" ? "Test email captured." : `${body.queued} campaign messages queued.` : body.error);
    await loadEmailHub();
  }

  async function sendPlatformTest() {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "test_email", recipient: testRecipient }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Platform test email captured." : body.error);
    await loadEmailHub();
  }

  return (
    <>
      <p className="eyebrow">Settings</p>
      <h1>Store operations</h1>
      <div className="tabs"><a href="#orders">Orders</a><a href="#shipping">Shipping</a><a href="#email">Email</a><a href="#developer">Developer</a></div>
      <form className="card" onSubmit={saveSettings}>
        <section id="orders"><h2>Orders</h2><label>Store status<select onChange={(event) => setSettings({ ...settings, storeStatus: event.target.value as Settings["storeStatus"] })} value={settings.storeStatus}><option value="OPEN">Open</option><option value="CLOSED">Closed</option></select></label><p>Package types, pickup locations, and follow-up rules will be connected in later operations phases.</p></section>
        <section id="shipping"><h2>Shipping</h2><label>Delivery ZIP codes<textarea onChange={(event) => setSettings({ ...settings, deliveryZipCodes: event.target.value.split(/[\s,]+/).filter(Boolean) })} value={settings.deliveryZipCodes.join(", ")} /></label><label>Purim-week delivery dates<textarea onChange={(event) => setSettings({ ...settings, deliveryDates: event.target.value.split(/[\s,]+/).filter(Boolean) })} value={settings.deliveryDates.join(", ")} /></label><p>Checkout uses these ZIP and date rules now. Live carrier rates arrive in P8.</p></section>
        <section id="email">
          <h2>Email</h2>
          <p>{emailHub.pendingOutbox} message{emailHub.pendingOutbox === 1 ? "" : "s"} waiting in the transactional outbox.</p>
          <label>Campaign name<input onChange={(event) => setCampaign({ ...campaign, name: event.target.value })} value={campaign.name} /></label>
          <label>Subject<input onChange={(event) => setCampaign({ ...campaign, subject: event.target.value })} value={campaign.subject} /></label>
          <label>HTML body<textarea onChange={(event) => setCampaign({ ...campaign, body: event.target.value })} value={campaign.body} /></label>
          <button className="button secondary" onClick={() => void createCampaign()} type="button">Save campaign draft</button>
          <label>Test recipient<input onChange={(event) => setTestRecipient(event.target.value)} placeholder="staff@example.test" value={testRecipient} /></label>
          <button className="button secondary" disabled={!testRecipient} onClick={() => void sendPlatformTest()} type="button">Send platform test</button>
          <p>Lists: {emailHub.lists.length ? emailHub.lists.map((list) => `${list.name} (${list._count.members})`).join(", ") : "All confirmed subscribers"}</p>
          <details>
            <summary>Transactional templates and branding</summary>
            {emailHub.templates.map((template) => <p key={template.id}><strong>{template.key}</strong> · {template.subject} · {Object.keys(template.branding).length ? "custom branding" : "default branding"}</p>)}
          </details>
          <div className="ops-list">
            {emailHub.campaigns.map((savedCampaign) => (
              <div className="ops-row" key={savedCampaign.id}>
                <span><strong>{savedCampaign.name}</strong> · {savedCampaign.subject} · {savedCampaign.status}</span>
                <span>
                  <button className="button secondary" disabled={!testRecipient} onClick={() => void runCampaign("test_campaign", savedCampaign.id)} type="button">Test-send</button>
                  <button className="button secondary" onClick={() => void runCampaign("send_campaign", savedCampaign.id)} type="button">Send campaign</button>
                </span>
              </div>
            ))}
          </div>
        </section>
        <section id="developer"><h2>Developer</h2><p>Health, environment validation, and the local test database are available now.</p></section>
        <button className="button" type="submit">Save settings</button>
      </form>
      {message && <p role="status">{message}</p>}
    </>
  );
}
