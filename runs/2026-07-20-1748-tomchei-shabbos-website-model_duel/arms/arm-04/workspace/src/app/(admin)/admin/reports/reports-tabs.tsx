import { TabNav } from '@/components/ui/tab-nav';

const REPORT_TABS = [
  { href: '/admin/reports', label: 'Seasons' },
  { href: '/admin/reports/margin', label: 'Shipping margin' },
  { href: '/admin/reports/exports', label: 'Exports' },
  { href: '/admin/reports/payments', label: 'Payment reconciliation' },
] as const;

export type ReportTab = (typeof REPORT_TABS)[number]['href'];

export function ReportTabs({ active }: { active: ReportTab }) {
  return (
    <TabNav items={REPORT_TABS} active={active} ariaLabel="Report sections" testId="reports-tabs" />
  );
}
