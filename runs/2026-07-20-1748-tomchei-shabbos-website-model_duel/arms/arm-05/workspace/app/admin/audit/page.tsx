"use client";

import { useEffect, useState } from "react";

type AuditEvent = { id: string; action: string; details: Record<string, unknown>; createdAt: string };

export default function AuditPage() {
  const [audits, setAudits] = useState<AuditEvent[]>([]);

  useEffect(() => {
    void fetch("/api/audit").then(async (response) => setAudits((await response.json()).audits));
  }, []);

  return (
    <>
      <p className="eyebrow">Security audit</p>
      <h1>Traceable staff access</h1>
      <div className="card">
        {audits.length === 0 ? <p>No security events yet.</p> : audits.map((audit) => (
          <p key={audit.id}>
            <strong>{audit.action}</strong><br />
            {Object.entries(audit.details).map(([key, value]) => `${key}: ${String(value)}`).join(" · ")}<br />
            <small>{audit.createdAt}</small>
          </p>
        ))}
      </div>
    </>
  );
}
