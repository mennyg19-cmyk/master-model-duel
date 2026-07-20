import { CheckoutForm } from "@/components/checkout-form";

export const dynamic = "force-dynamic";

export default async function CheckoutPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return <CheckoutForm draftId={draftId} />;
}
