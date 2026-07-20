import Link from "next/link";
import { NewsletterForm } from "@/components/newsletter-form";
import { StorefrontHeader } from "@/components/storefront-header";
import { brand } from "@/lib/brand";
import { getCurrentSeason } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function StorefrontLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const season = await getCurrentSeason();
  const isOpen = season?.status === "OPEN";

  return (
    <div className="min-h-screen">
      <StorefrontHeader isOpen={isOpen} />
      {children}
      <footer className="bg-[var(--ink)] text-white">
        <div className="mx-auto grid max-w-7xl gap-10 px-5 py-14 md:grid-cols-[1fr_1.3fr]">
          <div>
            <p className="text-xl font-extrabold">{brand.name}</p>
            <p className="mt-3 max-w-sm text-sm leading-6 text-white/65">
              Neighbors helping neighbors celebrate Purim with dignity, warmth,
              and a full table.
            </p>
            <div className="mt-6 flex gap-5 text-sm font-semibold text-white/80">
              <Link href="/catalog">Shop</Link>
              <Link href="/collections">Archive</Link>
              <Link href="/admin">Staff portal</Link>
            </div>
          </div>
          <NewsletterForm compact />
        </div>
        <div className="border-t border-white/10 px-5 py-5 text-center text-xs text-white/45">
          © {new Date().getFullYear()} {brand.name}. Every gift supports local families.
        </div>
      </footer>
    </div>
  );
}
