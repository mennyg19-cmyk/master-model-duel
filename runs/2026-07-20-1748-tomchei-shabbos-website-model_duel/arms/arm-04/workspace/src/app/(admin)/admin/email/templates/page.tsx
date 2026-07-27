import { resetTemplateAction, saveTemplateAction } from './actions';
import { EmailTabs } from '../email-tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label, Textarea } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';
import {
  TRIGGERED_TEMPLATES,
  TRIGGERED_TEMPLATE_KEYS,
  type TriggeredTemplateKey,
} from '@/lib/email/templates';

export const dynamic = 'force-dynamic';

/**
 * The emails the app sends on its own (R-086).
 *
 * The shipped wording lives in code and is what runs until somebody saves an
 * override, so a fresh database sends sensible emails on day one and Reset
 * always has somewhere to go back to.
 */
export default async function TriggeredTemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  await requirePermission('email.manage');

  const [flash, overrides] = await Promise.all([
    searchParams,
    db.emailTemplate.findMany(),
  ]);

  const overrideByKey = new Map(overrides.map((override) => [override.key, override]));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Triggered emails</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          What the app writes by itself when an order is placed, paid for, or refunded.
        </p>
      </header>

      <EmailTabs active="/admin/email/templates" />
      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="templates" />

      {TRIGGERED_TEMPLATE_KEYS.map((key) => {
        const shipped = TRIGGERED_TEMPLATES[key];
        const override = overrideByKey.get(key);
        const current = override ?? shipped;

        return (
          <Card key={key} data-testid="template-card" data-key={key}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>{shipped.name}</CardTitle>
                <CardDescription>{shipped.description}</CardDescription>
              </div>
              <Badge tone={override ? 'warning' : 'neutral'}>
                {override ? 'Edited here' : 'Shipped wording'}
              </Badge>
            </div>

            <form action={saveTemplateAction} className="mt-4 grid gap-4">
              <input type="hidden" name="key" value={key} />

              <div>
                <Label htmlFor={`subject-${key}`}>Subject</Label>
                <Input id={`subject-${key}`} name="subject" defaultValue={current.subject} />
              </div>

              <div>
                <Label htmlFor={`body-${key}`}>Message</Label>
                <Textarea id={`body-${key}`} name="body" rows={8} defaultValue={current.body} />
                <p className="mt-1 text-xs text-[var(--color-ink-muted)]">
                  Fields you can use: {placeholderList(key)}
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  name="isEnabled"
                  defaultChecked={override?.isEnabled ?? true}
                  data-testid={`enabled-${key}`}
                />
                Send this email
              </label>

              <div className="flex gap-3">
                <Button type="submit">Save</Button>
              </div>
            </form>

            {override ? (
              <form action={resetTemplateAction} className="mt-3">
                <input type="hidden" name="key" value={key} />
                <Button type="submit" variant="ghost">
                  Back to the shipped wording
                </Button>
              </form>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}

function placeholderList(key: TriggeredTemplateKey): string {
  return TRIGGERED_TEMPLATES[key].variables.map((name) => `{{${name}}}`).join(', ');
}
