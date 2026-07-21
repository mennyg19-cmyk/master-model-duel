import { Suspense } from "react";
import MockPayInner from "./mock-pay-inner";

export default function MockPayPage() {
  return (
    <Suspense fallback={<main className="px-4 py-16 text-center">Loading…</main>}>
      <MockPayInner />
    </Suspense>
  );
}
