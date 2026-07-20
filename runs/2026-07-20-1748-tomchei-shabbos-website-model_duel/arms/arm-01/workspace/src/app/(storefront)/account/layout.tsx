import Link from "next/link";

export default function AccountLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="min-h-[65vh] bg-[var(--cream)] px-5 py-10">
      <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-[220px_1fr]">
        <nav
          aria-label="Customer account"
          className="flex gap-2 overflow-x-auto md:flex-col"
        >
          <Link className="rounded-xl bg-white px-4 py-3 font-bold" href="/account">
            Dashboard
          </Link>
          <Link className="rounded-xl bg-white px-4 py-3 font-bold" href="/account/profile">
            Profile
          </Link>
          <Link className="rounded-xl bg-white px-4 py-3 font-bold" href="/account/addresses">
            Address book
          </Link>
        </nav>
        {children}
      </div>
    </main>
  );
}
