import { env } from "@/lib/env";

// Test/live environment switch (R-014, R-101, R-129). The app is in TEST mode
// when the money path is the mock gateway (no Stripe key / STRIPE_MODE=mock) or
// when TEST_MODE / IS_TEST_ENV is set explicitly. Everything test-only — the
// console's destructive routes, the banner — keys off this one function, so
// live configuration flips it all off at once.
export function isTestMode(): boolean {
  const stripeMock =
    process.env.STRIPE_MODE === "mock" ||
    !env.STRIPE_SECRET_KEY ||
    env.STRIPE_SECRET_KEY === "sk_test_mock";
  const flagged =
    env.TEST_MODE ||
    process.env.IS_TEST_ENV === "true" ||
    process.env.IS_TEST_ENV === "1";
  return flagged || stripeMock;
}
