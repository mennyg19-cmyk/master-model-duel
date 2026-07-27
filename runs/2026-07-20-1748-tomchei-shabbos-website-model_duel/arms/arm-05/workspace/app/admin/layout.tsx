import Link from "next/link";

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="shell">
      <aside className="sidebar">
        <strong>Tomchei Shabbos</strong>
        <Link href="/admin">Overview</Link>
        <Link href="/admin/staff">Staff & permissions</Link>
        <Link href="/admin/audit">Security audit</Link>
      </aside>
      <section className="content">{children}</section>
    </div>
  );
}
