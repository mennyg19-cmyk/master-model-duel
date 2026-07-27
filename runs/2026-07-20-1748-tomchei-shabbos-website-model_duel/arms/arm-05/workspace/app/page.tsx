import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <p className="eyebrow">Tomchei Shabbos</p>
      <h1>Operations start here.</h1>
      <p className="lead">
        Phase one establishes the secure staff foundation for the Purim program:
        first-run setup, permissions, staff accounts, and an auditable admin shell.
      </p>
      <div className="grid">
        <section className="card">
          <h2>First-run setup</h2>
          <p>Create the first Manager exactly once.</p>
          <Link className="button" href="/setup">Open setup</Link>
        </section>
        <section className="card">
          <h2>Staff operations</h2>
          <p>Manage access, role overrides, revocations, and audit events.</p>
          <Link className="button secondary" href="/admin">Open admin</Link>
        </section>
      </div>
    </main>
  );
}
