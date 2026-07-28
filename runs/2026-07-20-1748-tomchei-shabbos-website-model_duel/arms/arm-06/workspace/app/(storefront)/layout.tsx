import Link from "next/link";
import { BRAND } from "@/lib/brand";
import { prisma } from "@/lib/db";
import { getOpenSeason } from "@/lib/seasons/queries";
import { getCustomerContext } from "@/lib/customers/session";
import { SiteHeader } from "@/components/storefront/site-header";
import { SubscribeForm } from "@/components/storefront/subscribe-form";

export const dynamic = "force-dynamic";

// R-011/012/013: storefront shell — sticky header, storewide closed banner
// when no season is open, footer with the newsletter signup.
export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const [openSeason, closedSeasonCount, customerCtx] = await Promise.all([
    getOpenSeason(),
    prisma.season.count({ where: { status: "CLOSED" } }),
    getCustomerContext(),
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader customerName={customerCtx?.customer.name ?? null} />
      {!openSeason && (
        <div className="bg-accent-100 px-4 py-2 text-center text-sm font-medium text-amber-900" role="status">
          {closedSeasonCount > 0 ? (
            <>
              Ordering is closed for this season — browse{" "}
              <Link href="/past-collections" className="underline">
                past collections
              </Link>{" "}
              and join the list for next year.
            </>
          ) : (
            "Ordering is closed — join the list below to hear when our first season opens."
          )}
        </div>
      )}
      <div className="flex-1">{children}</div>
      <footer className="border-t border-stone-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 md:grid-cols-2">
          <div>
            <p className="font-semibold text-stone-900">{BRAND.orgName}</p>
            <p className="mt-2 text-sm text-stone-600">{BRAND.tagline}.</p>
            <p className="mt-2 text-sm text-stone-500">{BRAND.supportEmail}</p>
          </div>
          <div>
            <p className="font-semibold text-stone-900">Get season updates</p>
            <p className="mt-1 text-sm text-stone-600">
              New packages, reminders before Purim, and community news.
            </p>
            <div className="mt-3">
              <SubscribeForm source="footer" />
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
