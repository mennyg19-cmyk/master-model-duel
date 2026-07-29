"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface TemplateRow {
  id: string;
  key: string;
  name: string;
  subject: string;
  bodyText: string;
}

export function TemplatesTab({ templates }: { templates: TemplateRow[] }) {
  const router = useRouter();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [edits, setEdits] = useState<Record<string, { subject: string; bodyText: string }>>({});
  const [error, setError] = useState<string | null>(null);

  async function createTemplate(event: FormEvent) {
    event.preventDefault();
    const result = await apiFetch("/api/admin/email/templates", { method: "POST", body: { key, name, subject, bodyText } });
    if (!result.ok) {
      setError(result.body.error ?? "Could not create the template");
      return;
    }
    setKey("");
    setName("");
    setSubject("");
    setBodyText("");
    setError(null);
    router.refresh();
  }

  async function saveTemplate(template: TemplateRow) {
    const edit = edits[template.id];
    if (!edit) return;
    await apiFetch(`/api/admin/email/templates/${template.id}`, { method: "PATCH", body: edit });
    router.refresh();
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_340px]" data-templates-tab>
      <div className="flex flex-col gap-4">
        {templates.map((template) => {
          const edit = edits[template.id] ?? { subject: template.subject, bodyText: template.bodyText };
          return (
            <Card key={template.id} className="p-5" data-template-card={template.key}>
              <CardTitle>
                {template.name} <code className="ml-1 rounded bg-stone-100 px-1 text-sm">{template.key}</code>
              </CardTitle>
              <div className="mt-3 flex flex-col gap-2">
                <div>
                  <Label htmlFor={`template-subject-${template.id}`}>Subject</Label>
                  <Input
                    id={`template-subject-${template.id}`}
                    value={edit.subject}
                    onChange={(event) =>
                      setEdits((current) => ({ ...current, [template.id]: { ...edit, subject: event.target.value } }))
                    }
                    data-template-subject={template.key}
                  />
                </div>
                <div>
                  <Label htmlFor={`template-body-${template.id}`}>Body</Label>
                  <textarea
                    id={`template-body-${template.id}`}
                    className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                    rows={5}
                    value={edit.bodyText}
                    onChange={(event) =>
                      setEdits((current) => ({ ...current, [template.id]: { ...edit, bodyText: event.target.value } }))
                    }
                    data-template-body={template.key}
                  />
                </div>
                <div>
                  <Button size="sm" variant="secondary" onClick={() => saveTemplate(template)} data-template-save={template.key}>
                    Save template
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
        {templates.length === 0 && <p className="text-sm text-stone-500">No templates yet.</p>}
      </div>

      <Card className="h-fit p-5">
        <CardTitle>New template</CardTitle>
        <form className="mt-3 flex flex-col gap-3" onSubmit={createTemplate} data-template-create-form>
          <div>
            <Label htmlFor="template-key">Key (snake_case, stable)</Label>
            <Input id="template-key" value={key} onChange={(event) => setKey(event.target.value)} required data-template-key />
          </div>
          <div>
            <Label htmlFor="template-name">Name</Label>
            <Input id="template-name" value={name} onChange={(event) => setName(event.target.value)} required data-template-name-input />
          </div>
          <div>
            <Label htmlFor="template-subject-new">Subject</Label>
            <Input id="template-subject-new" value={subject} onChange={(event) => setSubject(event.target.value)} required data-template-subject-new />
          </div>
          <div>
            <Label htmlFor="template-body-new">Body</Label>
            <textarea
              id="template-body-new"
              className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
              rows={5}
              value={bodyText}
              onChange={(event) => setBodyText(event.target.value)}
              required
              data-template-body-new
            />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" data-template-create>
            Create template
          </Button>
        </form>
      </Card>
    </div>
  );
}
