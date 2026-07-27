"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import type { ActFn } from "@/components/admin/use-hub-act";
import type { SaveSettingFn } from "@/components/admin/settings/types";

export function EmailTab({
  emailFrom,
  emailReplyTo,
  brandingFooter,
  logRetentionDays,
  act,
  saveSetting,
}: {
  emailFrom: string;
  emailReplyTo: string;
  brandingFooter: string;
  logRetentionDays: number;
  act: ActFn;
  saveSetting: SaveSettingFn;
}) {
  const [from, setFrom] = useState(emailFrom);
  const [replyTo, setReplyTo] = useState(emailReplyTo);
  const [footer, setFooter] = useState(brandingFooter);
  const [retention, setRetention] = useState(String(logRetentionDays));
  const [testTo, setTestTo] = useState("");

  return (
    <div className="space-y-4">
      <Card>
        <CardTitle>Sender identity &amp; branding</CardTitle>
        <div className="space-y-3 text-sm">
          <label className="block">
            From address
            <Input value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full max-w-md" />
          </label>
          <label className="block">
            Reply-to address
            <Input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} className="mt-1 block w-full max-w-md" />
          </label>
          <label className="block">
            Branding footer (appended to every outgoing email)
            <Input value={footer} onChange={(event) => setFooter(event.target.value)} className="mt-1 block w-full max-w-2xl" />
          </label>
          <div className="flex gap-2">
            <Button onClick={() => saveSetting("email.from_address", from)}>Save from</Button>
            <Button variant="secondary" onClick={() => saveSetting("email.reply_to", replyTo)}>Save reply-to</Button>
            <Button variant="secondary" onClick={() => saveSetting("email.branding_footer", footer)}>Save footer</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle>Test sender</CardTitle>
        <p className="mb-2 text-sm text-muted">
          Sends one email through the live delivery path right now and reports the outcome. In test mode it is captured, not sent.
        </p>
        <div className="flex gap-2 text-sm">
          <Input value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="you@example.com" className="w-72" />
          <Button
            disabled={!testTo}
            onClick={() =>
              act(async () => {
                const result = await apiFetch<{ outcome: string; error?: string | null }>("/api/admin/email/test", { body: { to: testTo } });
                if (!result.ok) return result;
                return {
                  ok: result.body.outcome === "sent" || result.body.outcome === "captured",
                  error: `Test email outcome: ${result.body.outcome}${result.body.error ? ` — ${result.body.error}` : ""}`,
                };
              }, "Test email sent.")
            }
          >
            Send test email
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle>Log retention</CardTitle>
        <p className="mb-2 text-sm text-muted">
          The purge cron deletes finished email logs older than this many days. Queued and in-flight mail is never purged.
        </p>
        <div className="flex gap-2 text-sm">
          <Input value={retention} onChange={(event) => setRetention(event.target.value)} className="w-24" />
          <Button variant="secondary" onClick={() => saveSetting("email.log_retention_days", Number(retention))}>
            Save retention
          </Button>
        </div>
      </Card>
    </div>
  );
}
