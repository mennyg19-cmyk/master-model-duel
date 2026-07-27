import { isTestMode } from "@/lib/test-mode";

/** Test-mode banner (R-101): shown on every surface while no real money can move. */
export function TestModeBanner() {
  if (!isTestMode()) return null;
  return (
    <div
      role="status"
      data-testid="test-mode-banner"
      className="bg-amber-400 px-4 py-1 text-center text-xs font-semibold text-amber-950"
    >
      TEST MODE — payments run against the mock gateway; no real charges, emails, or labels.
    </div>
  );
}
