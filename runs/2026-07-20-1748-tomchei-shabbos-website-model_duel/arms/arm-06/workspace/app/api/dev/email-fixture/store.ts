// Shared in-process store for the Resend dev double. Both route halves (the
// provider-shaped [...tail] and the instrumentation root) read/write this
// module-level global so the recorded sends survive across invocations.
export interface FixtureSend {
  to: string[];
  subject: string;
  from: string;
  at: string;
}

export function fixtureSendsStore(): FixtureSend[] {
  const globalForFixture = globalThis as unknown as { emailFixtureSends?: FixtureSend[] };
  return (globalForFixture.emailFixtureSends ??= []);
}
