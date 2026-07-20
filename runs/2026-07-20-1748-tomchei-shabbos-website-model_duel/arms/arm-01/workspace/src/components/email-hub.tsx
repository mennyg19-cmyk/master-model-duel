"use client";

import { useState } from "react";

type EmailListChoice = { id: string; name: string };
type EmailTemplateChoice = {
  key: string;
  name: string;
  subject: string;
  htmlBody: string;
  textBody: string;
  isEnabled: boolean;
};
type CampaignSummary = {
  id: string;
  name: string;
  subject: string;
  status: string;
  emailList: { name: string };
  sentAt: string | null;
};
type MessageSummary = {
  id: string;
  eventKey: string;
  recipient: string;
  channel: string;
  status: string;
  attempts: number;
  lastError: string | null;
};

export function EmailHub({
  lists,
  initialTemplates,
  initialCampaigns,
  initialMessages,
}: {
  lists: EmailListChoice[];
  initialTemplates: EmailTemplateChoice[];
  initialCampaigns: CampaignSummary[];
  initialMessages: MessageSummary[];
}) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [testRecipient, setTestRecipient] = useState("");

  async function refreshHub() {
    const response = await fetch("/api/admin/email");
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setTemplates(payload.templates);
    setCampaigns(payload.campaigns);
    setMessages(payload.recentMessages);
  }

  async function createCampaign(formData: FormData) {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "createCampaign",
        name: formData.get("name"),
        subject: formData.get("subject"),
        htmlBody: formData.get("htmlBody"),
        textBody: formData.get("textBody"),
        emailListId: formData.get("emailListId"),
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Campaign draft created." : payload.error);
    if (response.ok) await refreshHub();
  }

  async function campaignAction(
    action: "testCampaign" | "sendCampaign",
    campaignId: string,
  ) {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, campaignId, recipient: testRecipient }),
    });
    const payload = await response.json();
    setMessage(
      response.ok
        ? `${payload.queued} message${payload.queued === 1 ? "" : "s"} queued.`
        : payload.error,
    );
    if (response.ok) await refreshHub();
  }

  async function saveTemplate(template: EmailTemplateChoice) {
    const response = await fetch("/api/admin/email", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(template),
    });
    const payload = await response.json();
    setMessage(response.ok ? `${template.name} saved.` : payload.error);
  }

  async function testTemplate(templateKey: string) {
    const response = await fetch("/api/admin/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "testTransactional",
        recipient: testRecipient,
        templateKey,
      }),
    });
    const payload = await response.json();
    setMessage(response.ok ? "Transactional test queued." : payload.error);
    if (response.ok) await refreshHub();
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Communications
      </p>
      <h1 className="mt-2 text-4xl font-black">Email hub</h1>
      <p className="mt-2 max-w-3xl text-[var(--muted)]">
        Build preference-aware campaigns, override transactional templates, and
        inspect durable delivery attempts.
      </p>

      <label className="mt-7 block max-w-xl font-bold">
        Test recipient
        <input
          className="mt-2 w-full rounded-xl border border-[var(--border)] px-4 py-3"
          onChange={(event) => setTestRecipient(event.target.value)}
          placeholder="staff@example.org"
          type="email"
          value={testRecipient}
        />
      </label>

      <section className="mt-10 rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-bold">New campaign</h2>
        <form action={createCampaign} className="mt-5 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <input className="rounded-xl border border-[var(--border)] px-4 py-3" name="name" placeholder="Campaign name" required />
            <select className="rounded-xl border border-[var(--border)] px-4 py-3" name="emailListId" required>
              {lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
          </div>
          <input className="rounded-xl border border-[var(--border)] px-4 py-3" name="subject" placeholder="Subject" required />
          <textarea className="min-h-28 rounded-xl border border-[var(--border)] px-4 py-3" name="htmlBody" placeholder="<p>Email body</p>" required />
          <textarea className="min-h-20 rounded-xl border border-[var(--border)] px-4 py-3" name="textBody" placeholder="Plain-text fallback" required />
          <button className="w-fit rounded-xl bg-[var(--brand)] px-5 py-3 font-bold text-white" type="submit">Save draft</button>
        </form>
        <div className="mt-7 divide-y divide-[var(--border)]">
          {campaigns.map((campaign) => (
            <article className="py-5" key={campaign.id}>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="font-bold">{campaign.name}</h3>
                  <p className="text-sm text-[var(--muted)]">{campaign.emailList.name} · {campaign.status}</p>
                  <p className="mt-1 text-sm">{campaign.subject}</p>
                </div>
                <div className="flex gap-2">
                  <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold" onClick={() => campaignAction("testCampaign", campaign.id)} type="button">Test</button>
                  <button className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white" onClick={() => campaignAction("sendCampaign", campaign.id)} type="button">Send</button>
                </div>
              </div>
            </article>
          ))}
          {!campaigns.length && <p className="py-6 text-[var(--muted)]">No campaign drafts yet.</p>}
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-bold">Transactional templates</h2>
        <div className="mt-5 space-y-5">
          {templates.map((template, index) => (
            <article className="rounded-2xl bg-[var(--surface)] p-5" key={template.key}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold">{template.name}</h3>
                  <code className="text-xs text-[var(--muted)]">{template.key}</code>
                </div>
                <label className="flex items-center gap-2 text-sm font-bold">
                  <input
                    checked={template.isEnabled}
                    onChange={(event) => {
                      const next = [...templates];
                      next[index] = { ...template, isEnabled: event.target.checked };
                      setTemplates(next);
                    }}
                    type="checkbox"
                  />
                  Enabled
                </label>
              </div>
              <input
                className="mt-4 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                onChange={(event) => {
                  const next = [...templates];
                  next[index] = { ...template, subject: event.target.value };
                  setTemplates(next);
                }}
                value={template.subject}
              />
              <textarea
                className="mt-3 min-h-20 w-full rounded-xl border border-[var(--border)] px-3 py-2"
                onChange={(event) => {
                  const next = [...templates];
                  next[index] = { ...template, htmlBody: event.target.value };
                  setTemplates(next);
                }}
                value={template.htmlBody}
              />
              <div className="mt-3 flex flex-wrap gap-2">
                <button className="rounded-full bg-[var(--ink)] px-4 py-2 text-sm font-bold text-white" onClick={() => saveTemplate(template)} type="button">Save override</button>
                <button className="rounded-full border border-[var(--border)] px-4 py-2 text-sm font-bold" onClick={() => testTemplate(template.key)} type="button">Send test</button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-8 rounded-3xl border border-[var(--border)] bg-white p-6">
        <h2 className="text-2xl font-bold">Recent outbox</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead><tr className="border-b border-[var(--border)]"><th className="py-3">Event</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Attempts</th></tr></thead>
            <tbody>
              {messages.map((entry) => (
                <tr className="border-b border-[var(--border)]" key={entry.id}>
                  <td className="py-3 font-medium">{entry.eventKey}</td>
                  <td>{entry.recipient}</td>
                  <td>{entry.channel}</td>
                  <td title={entry.lastError ?? undefined}>{entry.status}</td>
                  <td>{entry.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {message && <p aria-live="polite" className="mt-5 rounded-xl bg-[var(--brand-soft)] px-4 py-3 font-semibold">{message}</p>}
    </div>
  );
}
