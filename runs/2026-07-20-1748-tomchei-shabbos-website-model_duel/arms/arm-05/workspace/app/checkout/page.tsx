import { CheckoutFlow } from "@/app/components/checkout-flow";
import { StorefrontShell } from "@/app/components/storefront-shell";

export default function CheckoutPage() {
  return <StorefrontShell isOpen><CheckoutFlow /></StorefrontShell>;
}
