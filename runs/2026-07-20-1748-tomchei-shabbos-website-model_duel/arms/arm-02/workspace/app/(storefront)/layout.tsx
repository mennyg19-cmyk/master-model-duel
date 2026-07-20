import { getOpenSeason } from "@/lib/season";
import { getSetting } from "@/lib/settings";
import { SiteHeader } from "@/components/storefront/site-header";
import { SiteFooter } from "@/components/storefront/site-footer";

// Every storefront page reflects live DB state (season gate, catalog, settings).
// Prisma reads aren't request-time APIs, so without this Next would cache the
// pages statically and admin changes (close store, edit ZIPs) would not apply.
export const dynamic = "force-dynamic";

export default async function StorefrontLayout({ children }: { children: React.ReactNode }) {
  const openSeason = await getOpenSeason();
  const closedMessage = openSeason ? null : await getSetting("store.closed_message");

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader storeOpen={openSeason !== null} />
      {closedMessage && (
        <div role="status" className="bg-accent px-4 py-2 text-center text-sm font-medium text-white">
          {closedMessage}
        </div>
      )}
      {children}
      <SiteFooter />
    </div>
  );
}
