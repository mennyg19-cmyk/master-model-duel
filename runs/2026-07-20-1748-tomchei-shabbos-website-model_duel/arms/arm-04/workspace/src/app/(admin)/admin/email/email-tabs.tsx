import Link from 'next/link';

const EMAIL_TABS = [
  { href: '/admin/email', label: 'Campaigns' },
  { href: '/admin/email/lists', label: 'Lists' },
  { href: '/admin/email/templates', label: 'Triggered emails' },
  { href: '/admin/email/outbox', label: 'Outbox' },
] as const;

export type EmailTab = (typeof EMAIL_TABS)[number]['href'];

/** Same shape as the settings tabs, because it is the same kind of hub. */
export function EmailTabs({ active }: { active: EmailTab }) {
  return (
    <nav
      aria-label="Email sections"
      className="flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
      data-testid="email-tabs"
    >
      {EMAIL_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
          className={
            tab.href === active
              ? 'border-b-2 border-[var(--color-brand)] px-3 py-2 text-sm font-medium text-[var(--color-brand)]'
              : 'px-3 py-2 text-sm text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
