"use client";

import Link from "next/link";

export default function GlobalError() {
  return (
    <main>
      <p className="eyebrow">Tomchei Shabbos</p>
      <h1>We could not load that page.</h1>
      <p className="lead">The error was recorded without exposing internal details.</p>
      <Link className="button" href="/">Return home</Link>
    </main>
  );
}
