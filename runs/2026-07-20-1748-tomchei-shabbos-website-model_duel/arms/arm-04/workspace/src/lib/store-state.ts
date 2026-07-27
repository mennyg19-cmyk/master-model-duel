import 'server-only';

import type { Season } from '@prisma/client';

import { db } from './db';
import { readSetting } from './settings';

/**
 * Two switches decide whether the store takes orders, and both must be on:
 *
 * - the season's own OPEN/CLOSED status, which the scheduled flip moves (UR-008);
 * - the `store.open` setting, which a manager uses to stop orders right now
 *   without touching the season calendar.
 *
 * Reading them together in one place is what keeps the homepage CTA, the catalog
 * buy buttons and the `/order` route from disagreeing with each other.
 */
export type StoreState = {
  isOpen: boolean;
  /** The season the storefront is showing: the open one, or the most recent. */
  season: Season | null;
  seasonIsOpen: boolean;
  storeSwitchIsOn: boolean;
  announcement: string;
};

export async function readStoreState(): Promise<StoreState> {
  const [storeSwitchIsOn, announcement, openSeason] = await Promise.all([
    readSetting('store.open'),
    readSetting('brand.announcement'),
    db.season.findFirst({ where: { status: 'OPEN' }, orderBy: { year: 'desc' } }),
  ]);

  const season = openSeason ?? (await db.season.findFirst({ orderBy: { year: 'desc' } }));
  const seasonIsOpen = season?.status === 'OPEN';

  return {
    isOpen: storeSwitchIsOn && seasonIsOpen,
    season,
    seasonIsOpen,
    storeSwitchIsOn,
    announcement,
  };
}

export function closedStoreMessage(state: StoreState): string {
  if (!state.season) return 'Ordering has not opened yet. Check back soon.';
  if (!state.seasonIsOpen) return `${state.season.label} ordering has not opened yet.`;
  return 'Ordering is paused right now. Browsing stays open.';
}
