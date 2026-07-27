import { isTestMode } from '@/lib/testing/test-mode';

/**
 * The band that says none of this is real (R-101, R-129).
 *
 * On the storefront as well as the admin, because the rehearsal includes people
 * placing orders through the website and the worst outcome of a dress rehearsal
 * is a donor who thought their order was real.
 *
 * It cannot be dismissed. A banner with a close button is a banner that is shut
 * once on the first screen and never seen again.
 */
export async function TestModeBanner() {
  if (!(await isTestMode())) return null;

  return (
    <div
      role="status"
      className="bg-[var(--color-danger)] px-4 py-2 text-center text-sm font-medium text-white"
      data-testid="test-mode-banner"
    >
      Test mode — this is a rehearsal. Orders placed here are not real and may be deleted at any time.
    </div>
  );
}
