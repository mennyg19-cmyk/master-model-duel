import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { getSeasonYear } from "@/lib/season";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  const seasonYear = getSeasonYear(new Date());

  return (
    <main className="flex min-h-screen flex-col">
      <header className="bg-brand-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <span className="text-lg font-semibold">{BRAND.orgName}</span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/admin" className="text-brand-100 hover:text-white">
              Staff sign in
            </Link>
          </nav>
        </div>
      </header>

      <section className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-6 py-20">
        <span className="rounded-full bg-accent-100 px-3 py-1 text-sm font-medium text-amber-800">
          Season {seasonYear}
        </span>
        <h1 className="max-w-2xl text-4xl font-bold tracking-tight text-stone-900">
          {BRAND.productName}: {BRAND.tagline}
        </h1>
        <p className="max-w-xl text-lg text-stone-600">
          Order Purim packages for friends, family, and neighbors. Our volunteers pack and
          deliver across the community, and every package supports {BRAND.orgName}.
        </p>
        <div className="flex gap-3">
          <Button disabled title="Ordering opens in a later phase">
            Browse packages (coming soon)
          </Button>
          <Link href="/admin">
            <Button variant="secondary">Staff portal</Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-4 text-sm text-stone-500">
          {BRAND.orgName} · {BRAND.supportEmail}
        </div>
      </footer>
    </main>
  );
}
