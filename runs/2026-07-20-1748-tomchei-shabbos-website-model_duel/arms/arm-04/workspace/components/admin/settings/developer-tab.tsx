"use client";

import { Card, CardTitle } from "@/components/ui/card";

export function DeveloperTab() {
  return (
    <Card>
      <CardTitle>Developer</CardTitle>
      <ul className="space-y-1 text-sm text-muted">
        <li>Web: port 3102 · DB: embedded Postgres on 4102 (`npm run db:start`)</li>
        <li>Media storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set; local `.uploads/` otherwise</li>
        <li>Webhook + API key management arrives with the Stripe/Shippo phases</li>
      </ul>
    </Card>
  );
}
