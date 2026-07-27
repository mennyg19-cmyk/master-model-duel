import { RepeatOrderReview } from "@/app/components/repeat-order-review";
import { StorefrontShell } from "@/app/components/storefront-shell";
import { getStorefront } from "@/lib/storefront";

type RepeatPageProps = { params: Promise<{ draftId: string }> };

export const dynamic = "force-dynamic";

export default async function RepeatPage({ params }: RepeatPageProps) {
  const [{ currentSeason }, { draftId }] = await Promise.all([getStorefront(), params]);
  return <StorefrontShell isOpen={Boolean(currentSeason)}><RepeatOrderReview draftId={draftId} /></StorefrontShell>;
}
