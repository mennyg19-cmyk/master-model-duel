import Link from "next/link";
import { brand } from "@/lib/brand";
import type { Permission } from "@/lib/permissions";
import { StopImpersonationButton } from "@/components/admin/stop-impersonation-button";

const NAV: { href: string; label: string; permission: Permission }[] = [
  { href: "/admin", label: "Dashboard", permission: "admin.access" },
  { href: "/admin/pos", label: "POS", permission: "admin.access" },
  { href: "/admin/catalog", label: "Catalog", permission: "settings.write" },
  { href: "/admin/media", label: "Media", permission: "settings.write" },
  { href: "/admin/staff", label: "Staff", permission: "staff.manage" },
  { href: "/admin/audit", label: "Audit", permission: "audit.read" },
  { href: "/admin/settings", label: "Settings", permission: "settings.read" },
  { href: "/admin/gated", label: "Gated demo", permission: "staff.manage" },
];

export function AdminShell({
  children,
  permissions,
  impersonating,
  effectiveName,
  actorName,
}: {
  children: React.ReactNode;
  permissions: Set<Permission> | Permission[];
  impersonating?: boolean;
  effectiveName?: string;
  actorName?: string;
}) {
  const allowed = permissions instanceof Set ? permissions : new Set(permissions);
  const links = NAV.filter((item) => allowed.has(item.permission));

  return (
    <div className="min-h-screen bg-[var(--color-cream)] text-[var(--color-ink)]">
      {impersonating ? (
        <div className="bg-[var(--color-accent)] px-4 py-2 text-center text-sm font-semibold text-white">
          You are {actorName} acting as {effectiveName}.{" "}
          <StopImpersonationButton />
        </div>
      ) : null}
      <div className="mx-auto flex min-h-screen max-w-6xl gap-6 px-4 py-6">
        <aside className="hidden w-56 shrink-0 md:block">
          <div className="mb-6">
            <p className="font-[family-name:var(--font-display)] text-xl text-[var(--color-forest)]">
              {brand.shortName}
            </p>
            <p className="text-xs text-[var(--color-forest)]/70">Admin</p>
          </div>
          <nav className="flex flex-col gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-[var(--radius-md)] px-3 py-2 text-sm font-medium hover:bg-white"
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </aside>
        <div className="flex-1">
          <nav className="mb-4 flex gap-2 overflow-x-auto md:hidden">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="whitespace-nowrap rounded-full bg-white px-3 py-1 text-sm"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          {children}
        </div>
      </div>
    </div>
  );
}
