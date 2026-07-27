"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

export function StorefrontShell({ children, isOpen }: { children: React.ReactNode; isOpen: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [newsletterMessage, setNewsletterMessage] = useState("");

  async function subscribe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/newsletter", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
    const body = await response.json();
    setNewsletterMessage(response.ok ? body.message : body.error);
  }

  return (
    <>
      {!isOpen && <aside className="closed-banner">The Purim shop is closed. Browse past collections while we prepare the next season.</aside>}
      <header className="store-header">
        <Link className="brand" href="/">Tomchei Shabbos</Link>
        <button aria-expanded={menuOpen} className="menu-toggle" onClick={() => setMenuOpen((open) => !open)}>Menu</button>
        <nav className={menuOpen ? "store-nav open" : "store-nav"}>
          <Link href="/catalog">Shop</Link>
          <Link href="/collections">Past collections</Link>
          <Link href="/account">My account</Link>
          <Link href="/admin">Staff sign in</Link>
          {isOpen && <Link className="button" href="/order">Start an order</Link>}
        </nav>
      </header>
      {children}
      <footer className="store-footer">
        <div>
          <strong>Stay in the loop</strong>
          <p>Get Purim dates, gift ideas, and impact updates.</p>
        </div>
        <form className="newsletter-form" onSubmit={subscribe}>
          <label htmlFor="newsletter-email">Email address</label>
          <div><input id="newsletter-email" onChange={(event) => setEmail(event.target.value)} required type="email" value={email} /><button className="button" type="submit">Subscribe</button></div>
          {newsletterMessage && <p role="status">{newsletterMessage}</p>}
        </form>
      </footer>
    </>
  );
}
