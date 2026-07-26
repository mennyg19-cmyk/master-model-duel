/**
 * Reference numbers for carts in progress (R-047).
 *
 * Staff read these to customers over the phone, so the symbol set is Crockford
 * base32: no I, L, O or U, and the parser maps the letters people say anyway
 * ("oh" for zero, "eye" for one) back to the right digit. The last symbol is a
 * checksum, which catches a mistyped character but not two swapped ones.
 *
 * Wire form is `D-XXXX-XXXXC` and that is exactly what gets stored, so there is
 * no second "display" spelling of the same reference to keep in sync.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'D';
const BODY_LENGTH = 8;
const SPOKEN_SUBSTITUTIONS: Record<string, string> = { O: '0', I: '1', L: '1' };

export function createDraftReference(): string {
  const bytes = new Uint8Array(BODY_LENGTH);
  globalThis.crypto.getRandomValues(bytes);

  // 256 divides evenly by 32, so the modulo picks each symbol equally often.
  const body = [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join('');
  return formatDraftReference(body + checkSymbol(body));
}

/**
 * Accepts whatever a person types — lower case, missing dashes, spoken letter
 * confusions — and returns the canonical wire form, or null when the checksum
 * says the reference was misheard.
 */
export function parseDraftReference(input: string): string | null {
  const symbols = [...input.trim().toUpperCase()]
    .map((character) => SPOKEN_SUBSTITUTIONS[character] ?? character)
    .filter((character) => ALPHABET.includes(character))
    .join('');

  if (symbols.length !== PREFIX.length + BODY_LENGTH + 1) return null;
  if (!symbols.startsWith(PREFIX)) return null;

  const body = symbols.slice(PREFIX.length, PREFIX.length + BODY_LENGTH);
  const check = symbols.slice(PREFIX.length + BODY_LENGTH);
  if (check !== checkSymbol(body)) return null;

  return formatDraftReference(body + check);
}

function formatDraftReference(payload: string): string {
  return `${PREFIX}-${payload.slice(0, 4)}-${payload.slice(4)}`;
}

function checkSymbol(body: string): string {
  const total = [...body].reduce((sum, character) => sum + ALPHABET.indexOf(character), 0);
  return ALPHABET[total % ALPHABET.length];
}
