/**
 * Everything above the carrier wrapper works in grams. Two places leave that
 * world — the carrier's own request body and a screen showing a weight to
 * somebody holding the box — and they had a copy each of the conversion, one
 * rounding to two decimals and one to one. Same number, two spellings.
 *
 * The caller says how many decimals it wants, because those two answers are
 * genuinely different: a carrier bills on the figure, a person reads it.
 */
const GRAMS_PER_POUND = 453.59237;

export function gramsToPounds(grams: number, decimals: number): string {
  return (grams / GRAMS_PER_POUND).toFixed(decimals);
}
