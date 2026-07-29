import { NextResponse } from "next/server";
import { DomainRuleError, NotFoundError } from "@/lib/errors";

// One domain-error → HTTP ladder for API routes (clean-code Consistency):
// NotFoundError → 404, DomainRuleError → 422, route-specific typed errors via
// `extras` ([ErrorClass, status] pairs), anything else returns null so the
// route rethrows. Routes with a custom error body (e.g. the 409 conflict
// report) keep that branch explicit and fall through to this for the rest.
export function mapDomainError(
  error: unknown,
  extras: ReadonlyArray<readonly [new (...args: never[]) => Error, number]> = [],
): NextResponse | null {
  for (const [errorClass, status] of extras) {
    if (error instanceof errorClass) {
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
