import 'server-only';

import { redirectWithFlash } from '../forms/flash-redirect';
import { readActiveSeason } from './dashboard';

/**
 * The season a server action writes into, or a trip back to the screen saying
 * why it cannot.
 *
 * Every action that touches seasonal data needs the same two lines, and two
 * screens had already written their own copy with different wording. `fallback`
 * is where the person came from, because a routes action sending somebody to
 * the pickup counter is worse than no message at all.
 */
export async function requireWorkingSeasonOrRedirect(
  fallbackPath: string,
  problem: string,
): Promise<string> {
  const season = await readActiveSeason();
  if (!season) redirectWithFlash(fallbackPath, { problem });

  return season.id;
}
