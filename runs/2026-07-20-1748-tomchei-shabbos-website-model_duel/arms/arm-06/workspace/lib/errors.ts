// Typed errors for the domain engine (lib/). One error-handling approach per
// project (clean-code.mdc Consistency): domain failures raise typed classes so
// callers can instanceof-branch instead of message-matching. Domain-specific
// errors (IllegalTransitionError, InsufficientStockError, …) stay colocated in
// their engine modules; these two cover the shared shapes.

// Entity lookup failed (order/season/product/package/payment/…).
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "NotFoundError";
  }
}

// A business rule rejected the operation (season closed, order not FINALIZED,
// non-positive qty, malformed line, …). Message says what went wrong AND what
// the expected state was.
export class DomainRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainRuleError";
  }
}
