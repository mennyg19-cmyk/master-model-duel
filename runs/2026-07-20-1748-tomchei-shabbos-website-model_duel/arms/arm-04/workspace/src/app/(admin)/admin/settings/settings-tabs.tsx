import Link from 'next/link';

const SETTINGS_TABS = [
  { href: '/admin/settings', label: 'Orders' },
  { href: '/admin/settings/shipping', label: 'Shipping' },
  { href: '/admin/settings/email', label: 'Email' },
  { href: '/admin/settings/developer', label: 'Developer' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['href'];

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <nav
      aria-label="Settings sections"
      className="flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
      data-testid="settings-tabs"
    >
      {SETTINGS_TABS.map((tab) => (
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
