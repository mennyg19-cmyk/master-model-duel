"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ERROR_PREVIEW_CHARS, STATUS_TONES } from "@/components/admin/email/hub-display";

interface EditorCampaign {
  id: string;
  name: string;
  subject: string;
  bodyText: string;
  listId: string;
  listName: string;
  status: "DRAFT" | "SENDING" | "SENT" | "FAILED";
  sentAt: string | null;
  lastError: string | null;
}

interface RecipientRow {
  id: string;
  email: string;
  status: "PENDING" | "SENDING" | "SENT" | "FAILED" | "SKIPPED";
  attempts: number;
  providerId: string | null;
  lastError: string | null;
  sentAt: string | null;
}


export function CampaignEditor({
  campaign,
  lists,
  preview,
  recipients,
}: {
  campaign: EditorCampaign;
  lists: { id: string; name: string }[];
  preview: { subject: string; body: string };
  recipients: RecipientRow[];
}) {
  const router = useRouter();
  const [name, setName] = useState(campaign.name);
  const [subject, setSubject] = useState(campaign.subject);
  const [bodyText, setBodyText] = useState(campaign.bodyText);
  const [listId, setListId] = useState(campaign.listId);
  const [testAddress, setTestAddress] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isDraft = campaign.status === "DRAFT";

  function report(result: { ok: boolean; body: { error?: string } }, okMessage: string) {
    if (result.ok) {
      setStatus(okMessage);
      setError(null);
      router.refresh();
    } else {
      setError(result.body.error ?? "The request failed");
      setStatus(null);
    }
  }

  async function saveDraft(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    report(
      await apiFetch(`/api/admin/email/campaigns/${campaign.id}`, {
        method: "PATCH",
        body: { name, subject, bodyText, listId },
      }),
      "Draft saved.",
    );
    setBusy(false);
  }

  async function testSend(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    const result = await apiFetch<{ delivered: boolean; providerId: string | null; error: string | null }>(
      `/api/admin/email/campaigns/${campaign.id}/test-send`,
      { method: "POST", body: { toAddress: testAddress } },
    );
    if (result.ok && result.body.delivered) {
      setStatus(`Test email delivered (provider ${result.body.providerId ?? "n/a"}).`);
      setError(null);
    } else if (result.ok) {
      setError(`Test email failed: ${result.body.error ?? "unknown"}`);
      setStatus(null);
    } else {
      setError(result.body.error ?? "Test send failed");
      setStatus(null);
    }
    setBusy(false);
  }

  async function send() {
    setBusy(true);
    const result = await apiFetch<{ sent: number; failed: number; skipped: number; status: string }>(
      `/api/admin/email/campaigns/${campaign.id}/send`,
      { method: "POST" },
    );
    if (result.ok) {
      setStatus(
        `Send complete: ${result.body.sent} delivered, ${result.body.skipped} skipped, ${result.body.failed} failed — campaign ${result.body.status}.`,
      );
      setError(null);
      router.refresh();
    } else {
      setError(result.body.error ?? "Send failed");
      setStatus(null);
    }
    setBusy(false);
  }

  return (
    <div className="mt-4 grid max-w-6xl gap-6 lg:grid-cols-2" data-campaign-editor>
      <div className="flex flex-col gap-6">
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <CardTitle>Content</CardTitle>
            <Badge tone={STATUS_TONES[campaign.status]} data-campaign-status>
              {campaign.status}
            </Badge>
          </div>
          {isDraft ? (
            <form className="mt-3 flex flex-col gap-3" onSubmit={saveDraft} data-campaign-edit-form>
              <div>
                <Label htmlFor="editor-name">Name</Label>
                <Input id="editor-name" value={name} onChange={(event) => setName(event.target.value)} required data-editor-name />
              </div>
              <div>
                <Label htmlFor="editor-subject">Subject</Label>
                <Input id="editor-subject" value={subject} onChange={(event) => setSubject(event.target.value)} required data-editor-subject />
              </div>
              <div>
                <Label htmlFor="editor-body">Body</Label>
                <textarea
                  id="editor-body"
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                  rows={8}
                  value={bodyText}
                  onChange={(event) => setBodyText(event.target.value)}
                  required
                  data-editor-body
                />
              </div>
              <div>
                <Label htmlFor="editor-list">Send to list</Label>
                <select
                  id="editor-list"
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                  value={listId}
                  onChange={(event) => setListId(event.target.value)}
                  data-editor-list
                >
                  {lists.map((list) => (
                    <option key={list.id} value={list.id}>
                      {list.name}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit" variant="secondary" disabled={busy} data-editor-save>
                Save draft
              </Button>
            </form>
          ) : (
            <dl className="mt-3 flex flex-col gap-2 text-sm" data-campaign-readonly>
              <div>
                <dt className="text-xs uppercase text-stone-500">Subject</dt>
                <dd>{campaign.subject}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-stone-500">Body</dt>
                <dd className="whitespace-pre-wrap">{campaign.bodyText}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase text-stone-500">List</dt>
                <dd>{campaign.listName}</dd>
              </div>
              {campaign.sentAt && (
                <div>
                  <dt className="text-xs uppercase text-stone-500">Sent</dt>
                  <dd>{new Date(campaign.sentAt).toLocaleString()}</dd>
                </div>
              )}
              {campaign.lastError && (
                <div>
                  <dt className="text-xs uppercase text-stone-500">Last error</dt>
                  <dd className="text-red-700">{campaign.lastError}</dd>
                </div>
              )}
            </dl>
          )}
        </Card>

        <Card className="p-5">
          <CardTitle>Actions</CardTitle>
          <form className="mt-3 flex gap-2" onSubmit={testSend} data-campaign-test-form>
            <Input
              type="email"
              placeholder="test-recipient@example.org"
              value={testAddress}
              onChange={(event) => setTestAddress(event.target.value)}
              required
              data-campaign-test-address
            />
            <Button type="submit" variant="secondary" disabled={busy} data-campaign-test-send>
              Test send
            </Button>
          </form>
          <div className="mt-3">
            <Button onClick={send} disabled={busy} data-campaign-send>
              {campaign.status === "DRAFT" ? "Send campaign" : "Rerun send (no duplicates)"}
            </Button>
            <p className="mt-2 text-xs text-stone-500">
              Sends snapshot the list into recipient rows and deliver each exactly once; reruns only pick
              up new members and retry failures.
            </p>
          </div>
          {status && <p className="mt-3 text-sm text-green-700" data-campaign-action-status>{status}</p>}
          {error && <p className="mt-3 text-sm text-red-700" data-campaign-action-error>{error}</p>}
        </Card>
      </div>

      <div className="flex flex-col gap-6">
        <Card className="p-5" data-campaign-preview>
          <CardTitle>Preview (branding applied)</CardTitle>
          <p className="mt-3 text-sm font-medium" data-preview-subject>{preview.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm" data-preview-body>{preview.body}</pre>
        </Card>

        <Card className="p-5">
          <CardTitle>Recipients ({recipients.length})</CardTitle>
          <table className="mt-3 w-full text-left text-sm" data-recipient-list>
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
                <th className="py-2 pr-3">Email</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Attempts</th>
                <th className="py-2">Provider</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((recipient) => (
                <tr key={recipient.id} className="border-b border-stone-100" data-recipient-row={recipient.email}>
                  <td className="py-2 pr-3">{recipient.email}</td>
                  <td className="py-2 pr-3">
                    <Badge tone={STATUS_TONES[recipient.status]}>{recipient.status}</Badge>
                    {recipient.lastError && (
                      <span className="ml-1 text-xs text-red-700" title={recipient.lastError}>
                        {recipient.lastError.slice(0, ERROR_PREVIEW_CHARS)}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-3">{recipient.attempts}</td>
                  <td className="py-2 text-xs text-stone-500">{recipient.providerId ?? "—"}</td>
                </tr>
              ))}
              {recipients.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-3 text-stone-500">
                    Recipients snapshot on the first send.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
