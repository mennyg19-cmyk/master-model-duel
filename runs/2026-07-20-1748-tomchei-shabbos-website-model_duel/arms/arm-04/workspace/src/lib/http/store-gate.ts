import 'server-only';

import { forbidden } from 'next/navigation';
import type { Season } from '@prisma/client';

import { readStoreState, type StoreState } from '../store-state';

export type OpenStore = StoreState & { isOpen: true; season: Season };

/**
 * The server-side half of the closed-store rule (R-002). Hiding the buy buttons
 * is a courtesy; this is the part that holds when someone types the URL, so
 * every ordering route must call it before rendering anything.
 *
 * It lives apart from `store-state.ts` for the same reason `runCronJob` lives
 * apart from the job it runs: reading whether the store is open is a database
 * question any service may ask, and turning that answer into a 403 is something
 * only a route can do.
 */
export async function requireOpenStore(): Promise<OpenStore> {
  const state = await readStoreState();
  if (!state.isOpen || !state.season) forbidden();
  return state as OpenStore;
}
