import { NextResponse } from "next/server";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// One domain-error → HTTP ladder for API routes (clean-code Consistency):
// NotFoundError → 404, DomainRuleError → 422, route-specific typed errors via
// `extras` ([ErrorClass, status] pairs), anything else returns null so the
// route rethrows. Routes with a custom error body (e.g. the 409 conflict
// report) keep that branch explicit and fall through to this for the rest.
// An error carrying `clientMessage` (carrier API errors) responds with that
// staff-safe summary while the full detail goes to the server log.
export function mapDomainError(
  error: unknown,
  extras: ReadonlyArray<readonly [new (...args: never[]) => Error, number]> = [],
): NextResponse | null {
  for (const [errorClass, status] of extras) {
    if (error instanceof errorClass) {
      const clientMessage = (error as { clientMessage?: unknown }).clientMessage;
      if (typeof clientMessage === "string") {
        console.error(error.message);
        return NextResponse.json({ error: clientMessage }, { status });
      }
      return NextResponse.json({ error: error.message }, { status });
    }
  }
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof DomainRuleError) {
    return NextResponse.json({ error: error.message }, { status: 422 });
  }
  return null;
}

// The common route tail: map what we know, rethrow what we don't.
export function mapDomainErrorOrThrow(
  error: unknown,
  extras: ReadonlyArray<readonly [new (...args: never[]) => Error, number]> = [],
): NextResponse {
  const mapped = mapDomainError(error, extras);
  if (mapped) return mapped;
  throw error;
}
