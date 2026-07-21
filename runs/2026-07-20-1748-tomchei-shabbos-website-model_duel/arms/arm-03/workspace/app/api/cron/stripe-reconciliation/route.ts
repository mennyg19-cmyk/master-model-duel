import { requireCronAuth, runCronJob } from "@/lib/cron";
import { runPaymentReconciliation } from "@/lib/payments/reconcile";

// Nightly Stripe reconciliation (R-093 cron half). Same matcher as the run
// button; findings upsert on unique references so reruns never duplicate.
export async function POST(request: Request) {
  const denied = requireCronAuth(request);
  if (denied) return denied;

  const summary = await runCronJob("stripe-reconciliation", () => runPaymentReconciliation());
  return Response.json({ ok: true, ...summary });
}

// Vercel cron invokes with GET (R-185); same bearer-authed handler either way.
export { POST as GET };