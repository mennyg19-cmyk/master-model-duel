import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { formatCents } from "@/lib/catalog";
import { getPaymentGateway } from "@/lib/payments/stripe";
import { MockPayButtons } from "@/components/checkout/mock-pay-buttons";

/**
 * Stand-in for Stripe's hosted checkout page, mock mode only (no keys in this
 * environment). Visually distinct from the store on purpose: in production the
 * customer leaves our site here.
 */
export default async function MockStripeCheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string; success?: string; cancel?: string }>;
}) {
  // Read searchParams before touching the gateway: it marks the route dynamic,
  // so `next build` never evaluates the mock-only gateway during prerender.
  const { session: sessionId, success, cancel } = await searchParams;
  if (getPaymentGateway().mode !== "mock") notFound();
  if (!sessionId) notFound();
  const session = await db.stripeCheckoutSession.findUnique({
    where: { stripeSessionId: sessionId },
    include: { order: true },
  });
  if (!session) notFound();

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          Stripe test checkout (mock)
        </p>
        <h1 className="mt-2 text-lg font-semibold text-slate-900">
          Mishloach Manos order {session.order.draftReference}
        </h1>
        <p className="mt-4 text-3xl font-bold text-slate-900">{formatCents(session.amountCents)}</p>
        <p className="mt-1 text-sm text-slate-500">
          Session <code className="text-xs">{session.stripeSessionId}</code> — status {session.status}
        </p>
        <MockPayButtons
          sessionId={session.stripeSessionId}
          successUrl={success ?? "/checkout/success"}
          cancelUrl={cancel ?? "/checkout"}
        />
      </div>
    </main>
  );
}
