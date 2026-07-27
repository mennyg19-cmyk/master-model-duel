import Link from 'next/link';

import { cn } from '@/lib/cn';

export type TabNavItem = { href: string; label: string };

/**
 * The row of tabs every admin hub wears — settings, email, reports.
 *
 * One component rather than one per hub: three copies of this markup is three
 * places for the underline, the scroll behaviour and `aria-current` to drift,
 * and a settings screen that looks unlike the reports screen is a bug.
 */
export function TabNav({
  items,
  active,
  ariaLabel,
  testId,
}: {
  items: readonly TabNavItem[];
  active: string;
  ariaLabel: string;
  testId: string;
}) {
  return (
    <nav
      aria-label={ariaLabel}
      className="flex gap-1 overflow-x-auto border-b border-[var(--color-line)]"
      data-testid={testId}
    >
      {items.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
          className={cn(
            'px-3 py-2 text-sm',
            tab.href === active
              ? 'border-b-2 border-[var(--color-brand)] font-medium text-[var(--color-brand)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
