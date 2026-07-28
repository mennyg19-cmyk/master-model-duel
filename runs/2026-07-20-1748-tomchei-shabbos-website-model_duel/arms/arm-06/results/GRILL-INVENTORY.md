# Grill inventory — arm-06

Built from `GRILL-TRANSCRIPT.md` only. Evidence = turn numbers (T1–T11, Close).

## Governing constraints (locked, not features)

- Three goals held equally — flawless fulfillment, effortless ordering, delivery efficiency; no single priority referee (T1).
- Two immovable floors: staff simplicity (over-60 team runs fulfillment unaided) AND order-data integrity (degrade to paper rather than risk an order) (T2).

## Feature inventory

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-001 | Nightly print batch (paper-first fulfillment) | T3 | Printed paper is the authoritative fulfillment record, worked exactly like today: nightly print, staff file and work the paper, system learns fulfillment state afterward. Screen-as-truth rejected; one-tap confirmations / free reprints from option A were NOT picked. |
| G-002 | Live-first status entry | T4 | Preferred path: staff update the system live through the day so it stays current; must be dead-simple and easy enough for 60-year-olds. |
| G-003 | Paper batch-catchup ("mark everything off later") | T4 | Guaranteed safety net: if staff don't use the system, they keep working paper and mark everything off in a batch later; system tolerates days nobody touches it. UX shape OPEN (O-004). |
| G-004 | Divergence lock + manager exception screen | T5 | When paper and screen disagree, the order locks and lands on one short manager exception list; only a manager resolves it. Governs the mismatch case only — paper stays the record for the normal flow. Adds order lock/unlock states. |
| G-005 | Finished-packages inventory (v1) | T6 | Stock reserved the moment an order is placed; simple daily production entry per package type; storefront can honestly sell out. |
| G-006 | Component-level inventory (future option) | T6 | Not v1 scope: schema and production-entry design must not block component tracking + assembly conversion later; no timeline given. Adoption timing OPEN (O-006). |
| G-007 | Carrier-to-volunteer delivery switch (silent) | T7 | Shipping fee already paid stays with the nonprofit as fundraiser revenue; no refund workflow; switch is SILENT to the customer — no notification, and customer-facing order/tracking views must not leak the carrier-to-volunteer switch. |
| G-008 | Check/cash POS order lifecycle | T8 | Phone order entered as "paying by check" reserves inventory immediately (no sellout from under the customer) but does NOT enter the nightly print batch until marked paid. New states: reserved-unpaid, auto-release. POS scope details OPEN (O-005). |
| G-009 | Mark-paid + unpaid-orders list | T8 | Staff mark check/cash orders paid; unpaid orders tracked on one list; only payable orders reach the paper batch. |
| G-010 | Pay-by deadline with auto-release | T8 | Configurable deadline (e.g., 5 days before Purim — illustrative, not locked) auto-releases unpaid holds back into stock. Exact deadline and override rights OPEN (O-003). |
| G-011 | Map-based route building | T9 | Manager builds a route on the map (e.g., 20 stops, Google-ordered), possibly including switched ex-shipping packages. |
| G-012 | Driver web page | T9 | Big-button page: ordered stops, tap-to-navigate, "delivered" tap feeding live delivery status back into the system. |
| G-013 | Plain ordered address list (text/email) | T9 | Sent in route order for drivers who navigate with whatever they already use; effectively chosen per driver — nobody forced onto the web page. List-mode drivers leave status to staff catchup (absorbed by G-003/G-004). Printed-sheet/Maps-link from option A NOT picked as a requirement. |
| G-014 | Season open/closed switch | T10 | One staff-flipped switch per year; no section-by-section toggles. |
| G-015 | Off-season browse-only freeze | T10 | Closed-for-season banner with reopening note; cart/checkout/POS order-entry disabled; customer accounts, past orders, and address books viewable but frozen — no off-season editing or prep. |
| G-016 | Catalog-per-year with archive browsing | T10 | Each year gets its own catalog; every year's catalog (including the most recent) stays browsable off-season. |
| G-017 | Repeat-order confirmation page | T11 | Middle confirmation page: mapped replacements pre-filled for quick confirmation; unmapped lines stay highlighted "needs your choice" with suggestions from this year's catalog; draft cannot complete until each line is explicitly picked or deliberately dropped; no line ever silently removed. |
| G-018 | Replacement mapping at item setup | T11 | First-class catalog feature; skipping it has visible consequences on the repeat confirmation page (G-017). |

## OPEN items (unresolved human decisions — no defaults invented)

From the Close block:

- **O-001** — Shipping markup policy: whether any handling markup is added on top of the displayed carrier rate was never asked.
- **O-002** — Delivery-window mechanics: how per-year zip eligibility lists and per-option date windows (per-package delivery only in the day-or-two before Purim; bulk delivery anytime before Purim) are configured, and what happens to existing orders when a window closes mid-season.
- **O-003** — Check/cash deadline specifics: exact pay-by deadline ("5 days before Purim" was illustrative, not locked) and who, if anyone, can override an auto-release. Carried by G-010.
- **O-004** — Batch-catchup UX shape: what the "mark everything off later" screen actually looks like (one list? per-folder grouping?), beyond "easy enough for 60-year-olds." Carried by G-003.
- **O-005** — POS scope: phone vs. walk-in mix, who operates it, and hardware/receipt needs. Carried by G-008.
- **O-006** — Migration timeline: when or whether component-level inventory (T6 option B) and deeper fulfillment automation get adopted; deliberately left open. Carried by G-006.

O-001 and O-002 have no feature row: their topics never surfaced in T1–T11, so no turn-cited feature exists to carry them.

## Not covered (seed topics deliberately not grilled — per Close)

- Greeting-card content/design workflow (cards appear in the nightly print batch; authoring/managing card text not explored).
- Address-book internals (per-recipient delivery options, multiple addresses per recipient, sharing between family members).
- Route capacity and multi-driver splitting; bulk-delivery stop logistics on the map.
- Carrier integration mechanics (rate-shop APIs, label purchase flow, tracking numbers).
- Production scheduling detail beyond the daily per-type entry ("to-make" list generation not discussed).
- Guest checkout vs. required account, and customer self-service flows (address changes, order edits/cancellations).
- Success metrics / validation for the season — grill stayed at product-shape level.
