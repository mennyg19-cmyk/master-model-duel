import { CheckoutClient } from "@/components/checkout/checkout-client";

type Props = { searchParams: Promise<{ draft?: string; mode?: string }> };

export default async function CheckoutPage({ searchParams }: Props) {
  const params = await searchParams;
  const draft = params.draft;
  if (!draft) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center" data-testid="checkout-missing-draft">
        <p>Missing draft reference. Start from the order builder.</p>
      </main>
    );
  }
  return <CheckoutClient draftRef={draft} mode={params.mode === "pos" ? "pos" : "storefront"} />;
}
