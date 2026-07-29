import { DomainRuleError } from "@/lib/errors";
import { env } from "@/lib/env";

// R-129: test-only destructive routes exist for the test deployment. The
// class of deployment — not a flag near the button — is the guard:
// production refuses outright, no matter who asks or what override they hold.
export function requireTestEnv(): void {
  if (env.APP_ENV !== "test") {
    throw new DomainRuleError("Test operations are disabled outside the test environment");
  }
}
