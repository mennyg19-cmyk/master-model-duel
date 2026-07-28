import { CartLine, DraftState, PricedProduct, RecipientState } from "./types";

// Cart-first draft state (UR-006): items land in the cart first; recipient
// assignment is a separate per-line step. Pure reducer so the storefront and
// POS shells share identical behavior (R-031).
export type DraftAction =
  | { type: "add-line"; line: CartLine }
  | { type: "set-qty"; clientId: string; qty: number }
  | { type: "remove-line"; clientId: string }
  | { type: "assign-recipient"; clientId: string; recipientClientId: string | null }
  | { type: "upsert-recipient"; recipient: RecipientState }
  | { type: "remove-recipient"; clientId: string }
  | { type: "hydrate"; state: DraftState }
  | { type: "clear" };

export const EMPTY_DRAFT: DraftState = { lines: [], recipients: [] };

export function newClientId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `line-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case "add-line":
      return { ...state, lines: [...state.lines, action.line] };

    case "set-qty":
      if (action.qty <= 0) {
        return { ...state, lines: state.lines.filter((line) => line.clientId !== action.clientId) };
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.clientId === action.clientId ? { ...line, qty: action.qty } : line,
        ),
      };

    case "remove-line":
      return { ...state, lines: state.lines.filter((line) => line.clientId !== action.clientId) };

    case "assign-recipient":
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.clientId === action.clientId ? { ...line, recipientClientId: action.recipientClientId } : line,
        ),
      };

    case "upsert-recipient": {
      const exists = state.recipients.some((recipient) => recipient.clientId === action.recipient.clientId);
      return {
        ...state,
        recipients: exists
          ? state.recipients.map((recipient) =>
              recipient.clientId === action.recipient.clientId ? action.recipient : recipient,
            )
          : [...state.recipients, action.recipient],
      };
    }

    case "remove-recipient":
      // Removing a recipient unassigns its lines (mirrors SetNull on the server).
      return {
        lines: state.lines.map((line) =>
          line.recipientClientId === action.clientId ? { ...line, recipientClientId: null } : line,
        ),
        recipients: state.recipients.filter((recipient) => recipient.clientId !== action.clientId),
      };

    case "hydrate":
      return action.state;

    case "clear":
      return EMPTY_DRAFT;
  }
}

export function lineTotalCents(line: CartLine, product: PricedProduct): number {
  const delta = line.optionValueId
    ? (product.options.flatMap((option) => option.values).find((value) => value.id === line.optionValueId)
        ?.priceDeltaCents ?? 0)
    : 0;
  const addOnTotal = line.addOnIds.reduce((sum, addOnId) => {
    const addOn = product.addOns.find((candidate) => candidate.id === addOnId);
    return sum + (addOn ? addOn.priceCents : 0);
  }, 0);
  return line.qty * (product.basePriceCents + delta + addOnTotal);
}

export function cartTotalCents(state: DraftState, products: ({ id: string } & PricedProduct)[]): number {
  return state.lines.reduce((sum, line) => {
    const product = products.find((candidate) => candidate.id === line.productId);
    return sum + (product ? lineTotalCents(line, product) : 0);
  }, 0);
}
