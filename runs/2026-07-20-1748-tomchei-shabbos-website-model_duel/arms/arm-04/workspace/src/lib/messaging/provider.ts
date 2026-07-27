/**
 * One way to hand a message to somebody outside this building (R-171).
 *
 * Email and SMS are two accounts at two companies, but from the outbox's point
 * of view they are the same verb: take this text to this address and come back
 * with an id or an error. Keeping that verb in one place is what lets the
 * sweeper, the retry rule and the failure trail be written once instead of
 * twice, and what keeps every line that knows Resend's or Twilio's own
 * vocabulary inside a single file per provider.
 */
/**
 * A send that never answers must not hold a sweep open. The message stays
 * queued and the next sweep retries it under the same idempotency key, so a
 * request that was in fact delivered is not delivered twice. The sweeper's
 * claim window is derived from this, so the two cannot drift.
 */
export const PROVIDER_REQUEST_TIMEOUT_MS = 15_000;

export type OutgoingMessage = {
  destination: string;
  subject: string | null;
  /** Plain text. The only body an SMS has, and the fallback an email keeps. */
  body: string;
  /** The branded email twin of `body`. Null on channels that have no markup. */
  html: string | null;
  /**
   * Who it comes from, where the channel lets the organisation choose: the
   * `Name <address>` line for email. Null for SMS, which goes out from the one
   * number the account owns.
   */
  sender: string | null;
  replyTo: string | null;
  /**
   * The outbox row's dedupe key, passed to providers that honour it. A send
   * that times out is retried by the sweeper, and without this the provider
   * would have no way to know the second request is the same message.
   */
  idempotencyKey: string;
};

export type DeliveryReceipt = { providerReference: string };

export type MessageProvider = {
  readonly name: string;
  send(message: OutgoingMessage): Promise<DeliveryReceipt>;
};

/**
 * A provider refusing a request.
 *
 * The status and the provider are kept; the response body is not. A mail or
 * SMS API answers a bad request by quoting the request back — recipient
 * address and message text included — and this message is written to the
 * attempt trail, which is read far more widely than the outbox row.
 */
export class MessageProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number,
  ) {
    super(`${provider} refused the message with status ${status}`);
    this.name = 'MessageProviderError';
  }
}

/**
 * The id a provider hands back for an accepted message.
 *
 * A 2xx with no id is a change in their API, and treating it as a success
 * would leave a message marked sent with nothing to trace it by.
 */
export function extractProviderReference(payload: unknown, field: string, provider: string): string {
  const reference = (payload as Record<string, unknown> | null)?.[field];
  if (typeof reference !== 'string' || reference === '') {
    throw new Error(`${provider} accepted the message but returned no ${field} for it.`);
  }

  return reference;
}
