import { Suspense } from "react";
import CheckoutSuccessInner from "./success-inner";

export default function CheckoutSuccessPage() {
  return (
    <Suspense fallback={<main className="px-4 py-16 text-center">Confirming…</main>}>
      <CheckoutSuccessInner />
    </Suspense>
  );
}
