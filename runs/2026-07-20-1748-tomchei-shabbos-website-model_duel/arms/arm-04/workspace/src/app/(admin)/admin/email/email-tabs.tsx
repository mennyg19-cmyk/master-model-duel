import { TabNav } from '@/components/ui/tab-nav';

const EMAIL_TABS = [
  { href: '/admin/email', label: 'Campaigns' },
  { href: '/admin/email/lists', label: 'Lists' },
  { href: '/admin/email/templates', label: 'Triggered emails' },
  { href: '/admin/email/outbox', label: 'Outbox' },
] as const;

export type EmailTab = (typeof EMAIL_TABS)[number]['href'];

export function EmailTabs({ active }: { active: EmailTab }) {
  return <TabNav items={EMAIL_TABS} active={active} ariaLabel="Email sections" testId="email-tabs" />;
}
