import Link from "next/link";

export default function AdminPage() {
  return (
    <>
      <p className="eyebrow">Admin shell</p>
      <h1>Staff operations</h1>
      <p className="lead">Permission-aware navigation is ready for later order, fulfillment, and reporting work.</p>
      <div className="grid">
        <section className="card">
          <h2>Staff access</h2>
          <p>Invite users, assign a role, and set per-user permission exceptions.</p>
          <Link className="button" href="/admin/staff">Manage staff</Link>
        </section>
        <section className="card">
          <h2>Security audit</h2>
          <p>Every bootstrap, role change, revocation, and impersonation is recorded.</p>
          <Link className="button secondary" href="/admin/audit">View audit log</Link>
        </section>
      </div>
    </>
  );
}
