"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";
import { CartLine, DraftState, RecipientState, ViewerContext } from "./types";

// R-022: autosave. Signed-in customers save to the server draft
// (create-or-replace); guests save to localStorage and only get a server
// draft (+ access token, httpOnly cookie) when they hand us identity at
// checkout. The guest copy clears ONLY on success or explicit cancel — never
// on refresh (S2). An emptied cart IS saved: the server draft clears instead
// of keeping stale lines.
export const GUEST_DRAFT_KEY = "arm06_guest_draft";

export interface GuestDraftStorage extends DraftState {
  draftRef?: string;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function linesPayload(state: DraftState) {
  // Product lines carry caller ids so add-on lines can hang off them; add-on
  // qty mirrors the parent package qty (one bottle per package, etc.).
  return state.lines.flatMap((line) => [
    {
      id: line.clientId,
      productId: line.productId,
      optionValueId: line.optionValueId,
      qty: line.qty,
      recipientClientId: line.recipientClientId,
    },
    ...line.addOnIds.map((addOnId) => ({
      addOnId,
      parentLineId: line.clientId,
      qty: line.qty,
    })),
  ]);
}

export function recipientsPayload(recipients: RecipientState[]) {
  return recipients.map((recipient) => ({
    clientId: recipient.clientId,
    name: recipient.name,
    line1: recipient.line1,
    line2: recipient.line2,
    city: recipient.city,
    region: recipient.region,
    postalCode: recipient.postalCode,
    country: recipient.country,
    addressId: recipient.addressId,
    saveToBook: recipient.saveToBook,
    label: recipient.label,
  }));
}

export function readGuestDraft(): GuestDraftStorage | null {
  try {
    const raw = localStorage.getItem(GUEST_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuestDraftStorage;
    if (!Array.isArray(parsed.lines) || !Array.isArray(parsed.recipients)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeGuestDraft(draft: GuestDraftStorage): void {
  localStorage.setItem(GUEST_DRAFT_KEY, JSON.stringify(draft));
}

export function clearGuestDraft(): void {
  localStorage.removeItem(GUEST_DRAFT_KEY);
}

export function useAutoSave(input: {
  state: DraftState;
  viewer: ViewerContext;
  serverDraftRef: string | null;
  onSaved: (result: { draftRef: string }) => void;
  /** POS: alternate save endpoint + extra body fields (customerId). */
  saveUrl?: string;
  bodyExtra?: Record<string, unknown>;
}): { status: SaveStatus } {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateRef = useRef(input.state);
  stateRef.current = input.state;

  const stateKey = JSON.stringify(input.state);

  useEffect(() => {
    // First render / hydration replay: don't echo a freshly-loaded draft back.
    if (!dirtyRef.current) {
      dirtyRef.current = true;
      return;
    }
    // An emptied cart with no server draft has nothing to clear — skip only
    // then. Every other change (including emptying a server-backed cart) saves.
    if (input.state.lines.length === 0 && input.viewer.kind !== "guest" && !input.serverDraftRef) {
      return;
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      const snapshot = stateRef.current;
      if (input.viewer.kind === "guest") {
        writeGuestDraft({
          ...snapshot,
          ...(input.serverDraftRef ? { draftRef: input.serverDraftRef } : {}),
        });
        setStatus("saved");
        return;
      }
      setStatus("saving");
      const saveResult = await apiFetch<{ draftRef?: string }>(input.saveUrl ?? "/api/drafts", {
        method: "POST",
        body: {
          ...input.bodyExtra,
          ...(input.serverDraftRef ? { draftRef: input.serverDraftRef } : {}),
          lines: linesPayload(snapshot),
          recipients: recipientsPayload(snapshot.recipients),
        },
      });
      if (saveResult.ok && saveResult.body.draftRef) {
        setStatus("saved");
        input.onSaved({ draftRef: saveResult.body.draftRef });
      } else {
        setStatus("error");
      }
    }, 1200);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // stateKey is the real dependency; the rest are stable refs/callbacks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey]);

  return { status };
}
