"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import type { SaveSettingFn } from "@/components/admin/settings/types";

export function EmailTab({
  emailFrom,
  emailReplyTo,
  saveSetting,
}: {
  emailFrom: string;
  emailReplyTo: string;
  saveSetting: SaveSettingFn;
}) {
  const [from, setFrom] = useState(emailFrom);
  const [replyTo, setReplyTo] = useState(emailReplyTo);

  return (
    <Card>
      <CardTitle>Email</CardTitle>
      <p className="mb-3 text-sm text-muted">Sender identity. Templates and delivery wiring arrive with the email phase.</p>
      <div className="space-y-3 text-sm">
        <label className="block">
          From address
          <Input value={from} onChange={(event) => setFrom(event.target.value)} className="mt-1 block w-full max-w-md" />
        </label>
        <label className="block">
          Reply-to address
          <Input value={replyTo} onChange={(event) => setReplyTo(event.target.value)} className="mt-1 block w-full max-w-md" />
        </label>
        <div className="flex gap-2">
          <Button onClick={() => saveSetting("email.from_address", from)}>Save from</Button>
          <Button variant="secondary" onClick={() => saveSetting("email.reply_to", replyTo)}>Save reply-to</Button>
        </div>
      </div>
    </Card>
  );
}
