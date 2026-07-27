import Link from "next/link";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <strong>Tomchei Shabbos</strong>
        <Link href="/">Visit store</Link>
        <Link href="/admin">Overview</Link>
        <Link href="/admin/operations">Operations</Link>
        <Link href="/admin/pos">Point of sale</Link>
        <Link href="/admin/packages">Packages & print</Link>
        <Link href="/admin/delivery">Delivery operations</Link>
        <Link href="/admin/reports">Reports & exports</Link>
        <Link href="/admin/test-console">Test console</Link>
        <Link href="/admin/catalog">Catalog & media</Link>
        <Link href="/admin/seasons">Seasons & repeats</Link>
        <Link href="/admin/settings">Settings</Link>
        <Link href="/admin/staff">Staff & permissions</Link>
        <Link href="/admin/audit">Security audit</Link>
      </aside>
      <section className="content">
        <p className="admin-alert">{process.env.TEST_MODE === "true" ? "TEST MODE · outbound providers are fixture-backed and destructive controls are enabled." : "LIVE MODE · changes to orders, payments, and imports are audited."}</p>
        <p><Link href="/admin">← Back to admin overview</Link></p>
        {children}
      </section>
    </div>
  );
}
