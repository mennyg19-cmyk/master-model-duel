import type { EmailCampaignStatus } from '@prisma/client';

import { Badge } from '@/components/ui/badge';

/**
 * A campaign has three states and the office needs to be able to tell them
 * apart. Sending is the one that matters: a campaign shown as Draft while a
 * send is walking the list looks like it never went, which is an invitation to
 * press Send a second time.
 */
const CAMPAIGN_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SENDING: { label: 'Sending', tone: 'warning' },
  SENT: { label: 'Sent', tone: 'success' },
} as const;

export function CampaignStatusBadge({
  status,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { status: EmailCampaignStatus }) {
  const { label, tone } = CAMPAIGN_STATUS[status];

  return (
    <Badge tone={tone} {...props}>
      {label}
    </Badge>
  );
}
