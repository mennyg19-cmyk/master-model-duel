// Shared in-process store for the Stripe dev double (P12 reconciliation).
// Both route halves (instrumentation root + provider-shaped [...tail])
// read/write this module-level global so injected intents survive across
// invocations.
export interface FixtureIntent {
  id: string;
  amount: number;
  currency: string;
  status: string;
  metadata: Record<string, string>;
}

export function fixtureIntentsStore(): FixtureIntent[] {
  const globalForFixture = globalThis as unknown as { stripeFixtureIntents?: FixtureIntent[] };
  return (globalForFixture.stripeFixtureIntents ??= []);
}
