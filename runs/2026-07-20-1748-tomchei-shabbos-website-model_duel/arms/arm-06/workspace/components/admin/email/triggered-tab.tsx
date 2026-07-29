"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TemplateRow } from "@/components/admin/email/templates-tab";

export interface TriggeredRow {
  key: string;
  name: string;
  defaultSubject: string;
  enabled: boolean;
  subjectOverride: string | null;
  templateId: string | null;
}

export function TriggeredTab({ triggered, templates }: { triggered: TriggeredRow[]; templates: TemplateRow[] }) {
  const router = useRouter();
  const [edits, setEdits] = useState<Record<string, { enabled: boolean; subjectOverride: string; templateId: string }>>({});

  function stateFor(row: TriggeredRow) {
    return (
      edits[row.key] ?? {
        enabled: row.enabled,
        subjectOverride: row.subjectOverride ?? "",
        templateId: row.templateId ?? "",
      }
    );
  }

  async function save(row: TriggeredRow) {
    const edit = stateFor(row);
    await apiFetch(`/api/admin/email/triggered/${row.key}`, {
      method: "PATCH",
      body: {
        enabled: edit.enabled,
        subjectOverride: edit.subjectOverride.trim() === "" ? null : edit.subjectOverride,
        templateId: edit.templateId === "" ? null : edit.templateId,
      },
    });
    router.refresh();
  }

  return (
    <div className="flex max-w-4xl flex-col gap-4" data-triggered-tab>
      {triggered.map((row) => {
        const edit = stateFor(row);
        return (
          <Card key={row.key} className="p-5" data-triggered-card={row.key}>
            <div className="flex items-center justify-between">
              <CardTitle>
                {row.name} <code className="ml-1 rounded bg-stone-100 px-1 text-sm">{row.key}</code>
              </CardTitle>
              <Badge tone={edit.enabled ? "green" : "red"} data-triggered-state={row.key}>
                {edit.enabled ? "enabled" : "disabled"}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-stone-500">Default subject: {row.defaultSubject}</p>
            <div className="mt-3 flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={edit.enabled}
                  onChange={(event) => setEdits((current) => ({ ...current, [row.key]: { ...edit, enabled: event.target.checked } }))}
                  data-triggered-enabled={row.key}
                />
                Send this email when its event fires
              </label>
              <div>
                <Label htmlFor={`triggered-subject-${row.key}`}>Subject override (blank = default/template)</Label>
                <Input
                  id={`triggered-subject-${row.key}`}
                  value={edit.subjectOverride}
                  onChange={(event) =>
                    setEdits((current) => ({ ...current, [row.key]: { ...edit, subjectOverride: event.target.value } }))
                  }
                  data-triggered-subject={row.key}
                />
              </div>
              <div>
                <Label htmlFor={`triggered-template-${row.key}`}>Template (overrides the coded default body)</Label>
                <select
                  id={`triggered-template-${row.key}`}
                  className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                  value={edit.templateId}
                  onChange={(event) => setEdits((current) => ({ ...current, [row.key]: { ...edit, templateId: event.target.value } }))}
                  data-triggered-template={row.key}
                >
                  <option value="">Coded default</option>
                  {templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name} ({template.key})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Button size="sm" variant="secondary" onClick={() => save(row)} data-triggered-save={row.key}>
                  Save override
                </Button>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
