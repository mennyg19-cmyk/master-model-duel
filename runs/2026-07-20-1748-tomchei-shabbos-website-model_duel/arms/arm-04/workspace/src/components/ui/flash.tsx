/**
 * What the last action had to say, carried in the URL.
 *
 * Server actions redirect rather than return, so the only place a result can
 * live is the query string; every page that runs one shows it in the same two
 * shapes, in the same place, with `role="alert"` on the half that went wrong.
 * The test id prefix stays per-page so a smoke check can name the screen it is
 * reading.
 */
export function FlashMessages({
  notice,
  problem,
  testIdPrefix,
}: {
  notice?: string | null;
  problem?: string | null;
  testIdPrefix: string;
}) {
  return (
    <>
      {notice ? (
        <p
          className="rounded-md bg-[var(--color-success-soft)] px-3 py-2 text-sm text-[var(--color-success)]"
          data-testid={`${testIdPrefix}-notice`}
        >
          {notice}
        </p>
      ) : null}

      {problem ? (
        <p
          role="alert"
          className="rounded-md bg-[var(--color-danger-soft)] px-3 py-2 text-sm text-[var(--color-danger)]"
          data-testid={`${testIdPrefix}-problem`}
        >
          {problem}
        </p>
      ) : null}
    </>
  );
}
