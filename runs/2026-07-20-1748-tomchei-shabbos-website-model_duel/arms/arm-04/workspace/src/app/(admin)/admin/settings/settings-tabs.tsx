import { TabNav } from '@/components/ui/tab-nav';

const SETTINGS_TABS = [
  { href: '/admin/settings', label: 'Orders' },
  { href: '/admin/settings/shipping', label: 'Shipping' },
  { href: '/admin/settings/email', label: 'Email' },
  { href: '/admin/settings/developer', label: 'Developer' },
  { href: '/admin/settings/testing', label: 'Testing' },
] as const;

export type SettingsTab = (typeof SETTINGS_TABS)[number]['href'];

export function SettingsTabs({ active }: { active: SettingsTab }) {
  return (
    <TabNav items={SETTINGS_TABS} active={active} ariaLabel="Settings sections" testId="settings-tabs" />
  );
}
