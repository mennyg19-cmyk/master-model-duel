import { env } from "@/lib/env";

// Test/live environment switch (R-014, R-101, R-129). The app is in TEST mode
// when the money path is the mock gateway (no Stripe key) or when TEST_MODE is
// set explicitly. Everything test-only — the console's destructive routes, the
// banner — keys off this one function, so live configuration flips it all off
// at once.
export function isTestMode(): boolean {
  return env.TEST_MODE || !env.STRIPE_SECRET_KEY;
}
