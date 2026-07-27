import Link from "next/link";

export default function AdminPage() {
  return (
    <>
      <p className="eyebrow">Admin shell</p>
      <h1>Staff operations</h1>
      <p className="lead">Manage the live catalog and storefront settings alongside secure staff access.</p>
      <div className="grid">
        <section className="card">
          <h2>Order operations</h2>
          <p>Search live orders, work the Today queue, stage imports, and trace staff actions.</p>
          <Link className="button" href="/admin/operations">Open operations</Link>
        </section>
        <section className="card">
          <h2>Walk-in POS</h2>
          <p>Build a cash or check order with server-validated prices and inventory.</p>
          <Link className="button secondary" href="/admin/pos">Open point of sale</Link>
        </section>
        <section className="card">
          <h2>Packages & print</h2>
          <p>Track grouped physical packages and build nightly slips, labels, and greeting cards.</p>
          <Link className="button" href="/admin/packages">Open package board</Link>
        </section>
        <section className="card">
          <h2>Catalog & media</h2>
          <p>Add packages and add-ons, upload product photos, and spot missing imagery.</p>
          <Link className="button" href="/admin/catalog">Manage catalog</Link>
        </section>
        <section className="card">
          <h2>Store settings</h2>
          <p>Set store status and delivery ZIP rules before checkout launches.</p>
          <Link className="button secondary" href="/admin/settings">Open settings</Link>
        </section>
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
