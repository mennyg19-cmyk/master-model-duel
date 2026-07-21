# Grill transcript — arm-03 (late join, live)

Seed: `shared/GRILL-SEED.md`

---

## Turn 1
**Q:** For this first Purim season, who should the product optimize for first when those needs conflict?
**Options:**
- A — In-house staff (order-takers, packers, delivery managers, 60+) — dumb-simple daily work; public storefront stays basic credit-card checkout (**Recommended**)
- B — Public shoppers first — polished online buying; staff tools catch up later
- C — Split evenly from day one — storefront and staff tools both get equal depth
- D — Staff-only for year one — no public storefront; orders entered only by staff (POS)
**User:** C — Split evenly from day one; storefront and staff tools both get equal depth.
**I heard:** v1 invests in both a usable public credit-card storefront and equally capable staff/POS tools from launch; neither side is deferred when tradeoffs appear.
**Needed?** Sets the north star for scope and UX priority across the whole build — staff-simple vs shopper-polished vs balanced vs staff-only.

## Turn 2
**Q:** For year one, how should staff get packing slips, labels, and greeting cards into the house workflow?
**Options:**
- A — Mirror today: nightly batch-print of that day's orders **without** marking shipped; staff file paper into location / single-item folders (**Recommended**)
- B — Digital-first: on-screen queues replace paper folders; print is optional backup only
- C — Hybrid: digital folders on screen, but nightly batch print stays the default path staff use
- D — Full automation: printing auto-marks packed/shipped; no print-without-ship path
**User:** C — Hybrid, but full option both ways from day one: staff who want the automated on-screen workflow can use it from launch; staff who want the printout-and-file paper path can use that from launch too. Neither path deferred.
**I heard:** v1 ships both workflows in parallel — automated on-screen fulfillment queues and the legacy nightly batch print-and-file ritual; staff choose either path from day one; print-without-marking-shipped remains available for the paper path.
**Needed?** Locks fulfillment UX for 60+ volunteers — preserves proven paper habit while offering digital adoption without forcing either side to wait.

## Turn 3
**Q:** Given equal storefront + staff depth, and both on-screen automation and nightly print-and-file from day one: how should a single order handle destinations in v1?
**Options:**
- A — One destination per order — whole cart goes to one address / one delivery type; staff can split into separate orders if needed
- B — Full per-line destinations from day one — each line can ship, pickup, or deliver to its own recipient/address in both storefront and POS (**Recommended**)
- C — Per-line destinations in staff/POS only; public storefront is single-destination; staff expand multi-recipient later
- D — Recipients exist as a list, but all lines share one delivery mode; address-per-line comes in a later season
**User:** B — Full per-line destinations from day one in both storefront and POS.
**I heard:** Every cart line gets its own recipient, address, and delivery method (ship/pickup/deliver) from launch in both customer-facing and staff order entry — no single-destination shortcut or POS-only multi-recipient.
**Needed?** Core order model — per-recipient-from-ground-up as seed requires; affects cart UX, address book, packing folders, and print batches.

## Turn 4
**Q:** When checkout needs a shipping label, how should carrier rate-shopping work for what the customer sees vs what the org buys?
**Options:**
- A — Show the higher quote between carriers; buy the cheaper label (**Recommended**)
- B — Always show and buy the cheapest
- C — One preferred carrier only — show and buy that carrier
- D — Customer pays a flat or staff-set shipping fee; staff pick the carrier later
**User:** A — Show the higher quote; buy the cheaper label.
**I heard:** Checkout displays the highest carrier rate-shop quote; fulfillment purchases the cheapest eligible label; margin/spread stays with the org.
**Needed?** Seed requires rate-shop display vs cheaper actual ship — drives checkout pricing, label purchase, and reconciliation.

## Turn 5
**Q:** When a returning customer (or staff on POS) wants last year’s order again, but this year’s catalog items are different, how should year-one handle that?
**Options:**
- A — Full repeat-order: copy last year’s recipients, greeting cards, and lines into a draft; each this-year item can name which last-year item it replaces; a middle confirm page lets staff/shopper approve swaps before the cart loads (**Recommended**)
- B — Repeat recipients and addresses only; items must be chosen fresh every year
- C — One-click auto-swap to replacement items with no confirmation step
- D — No repeat-order in year one — address book only; rebuild carts by hand
**User:** A — Full repeat-order with replacement mappings and a middle confirm page before the cart loads.
**I heard:** Repeat copies last year's recipients, greetings, and lines into a draft; admin maps this-year items to last-year replacements; staff/shopper must confirm swaps on a middle page before cart submission.
**Needed?** Seed’s year-over-year repeat + replacement mapping is a major cart/POS feature; locks catalog setup fields and the confirm-before-cart step.

## Turn 6
**Q:** For year-one delivery, how should managers build volunteer routes when some nearby boxes were marked "ship"?
**Options:**
- A — Map of open deliveries; pick stops into a route; Google orders by quickest path; map also shows nearby shippable packages so staff can flip ship → volunteer delivery and save postage (**Recommended**)
- B — Routes only (map + pick stops + Google optimize) — no shippable-near-delivery hints; staff change modes elsewhere
- C — List of addresses only — no map, no Google optimize; staff order stops by hand
- D — Defer routing tools — print address lists; build routes outside the app
**User:** A — Full map routing with Google optimize and nearby shippable packages on the map for ship-to-delivery flips.
**I heard:** Managers build routes on a map with Google-optimized stop order; map surfaces shippable packages near delivery stops so staff can switch ship → volunteer delivery to save postage.
**Needed?** Seed's delivery map + route optimize + ship-near-delivery cost save — core ops feature for managers and drivers.

## Turn 7
**Q:** How should year-one checkout enforce the four delivery kinds (ship, pickup, bulk anytime-before-Purim, per-package near Purim)?
**Options:**
- A — Full rules from day one — zip allowlists, mode-specific prices, and date windows enforced in both storefront and POS (**Recommended**)
- B — Soft rules — all modes offered; staff fix invalid choices later
- C — Ship + pickup only in v1 — bulk and per-package delivery deferred
- D — Rules in POS only — public storefront is ship + pickup; staff apply the rest
**User:** A — Full rules from day one in both storefront and POS.
**I heard:** All four delivery modes with zip allowlists, mode-specific pricing, and date windows are hard-enforced at checkout in both customer-facing and staff order entry from launch.
**Needed?** Seed defines distinct rules per delivery type — locks checkout validation, fee config, and POS parity.

## Turn 8
**Q:** For year one, how should the house track in-house production and inventory (kits packed on site)?
**Options:**
- A — Simple production board: what to pack, what's ready, what's short; staff mark kits done as they finish (**Recommended**)
- B — Full inventory counts only (on-hand / reserved) — no packing board
- C — Paper/whiteboard outside the app; app only stores finished order docs
- D — Defer production tools — invent kit stock later
**User:** A — Simple production board with pack/ready/short tracking; staff mark kits done as they finish.
**I heard:** v1 includes a lightweight production board showing what needs packing, what's ready, and shortages; staff confirm kits complete as they finish assembly in-house.
**Needed?** Seed requires in-house inventory and production setup — locks how packing work is tracked for the small volunteer team.

## Turn 9
**Q:** Between Purim seasons, what should the public store do when the fundraiser is closed?
**Options:**
- A — Shut down buying, but let people browse past years' catalogs (read-only); each year keeps its own item list (**Recommended**)
- B — Full shutdown — no public browse off-season; staff only
- C — Keep buying open year-round on the current catalog
- D — Browse only the current year's catalog off-season; older years hidden
**User:** A — Shut down buying; browse past years' catalogs read-only; each year keeps its own item list.
**I heard:** Off-season disables checkout but public site offers read-only archive of prior years' catalogs; each Purim season has its own distinct item list.
**Needed?** Seed requires off-season shutdown + browse previous catalogs + per-year catalogs — locks public store status and season navigation.

## Turn 10
**Q:** For year one, which payment methods should the public storefront vs staff POS accept?
**Options:**
- A — Public: credit cards only; POS: also check and cash (**Recommended**)
- B — Cards everywhere (storefront and POS); no check/cash in v1
- C — Cards on storefront; POS is cash/check only (no card at the desk)
- D — All methods (card, check, cash) on both storefront and POS
**User:** A — Public credit cards only; POS also accepts check and cash.
**I heard:** Storefront checkout is card-only; staff POS additionally records check and cash payments for phone/walk-in orders.
**Needed?** Seed explicitly splits frontend cards vs backend check/cash — locks payment UI and reconciliation per channel.

## Turn 11
**Q:** For year one, how should greeting cards work for each recipient?
**Options:**
- A — Per-recipient custom message; templates optional; included on packing print and in repeat-order drafts (**Recommended**)
- B — Pick from a fixed template list only — no free-text messages
- C — One shared message for the whole order — not per recipient
- D — Defer greeting cards in the app — staff write them by hand outside the system
**User:** A — Per-recipient custom message; optional templates; on packing print and in repeat-order drafts.
**I heard:** Each recipient gets their own greeting card text (templates optional); messages print with packing docs and copy forward on repeat orders.
**Needed?** Nightly print ritual and repeat-order flow both depend on per-recipient greeting data model.

## Turn 12
**Q:** How should year-one attach each customer's address book (needed for recipients + repeat-order)?
**Options:**
- A — Shoppers log in (or magic-link); POS looks up/creates customers with a shared address book (**Recommended**)
- B — Guest checkout only; address books live in POS by phone/email lookup
- C — Auto-create a customer from email on every checkout; no passwords; merge by email
- D — No address book in v1 — re-enter addresses each order
**User:** A — Shoppers log in (or magic-link); POS looks up/creates customers with a shared address book.
**I heard:** Customers have accounts (login or magic-link on storefront); staff POS searches/creates the same customer record and shares one address book for recipients across web and phone orders.
**Needed?** Seed requires per-customer address book and repeat-order recipient copy — locks identity model and POS/customer linkage.

## Turn 13
**Q:** Once a manager builds a delivery route on the map, how should year-one get that route to the volunteer driver?
**Options:**
- A — In-app driver view (link or login): ordered stops, addresses, package notes; print optional (**Recommended**)
- B — Print / PDF only — manager prints the stop list; no driver login
- C — Text/email the stop list; no in-app driver screen
- D — Defer driver handoff — managers keep routes on their own screens and tell drivers verbally
**User:** A — In-app driver view (link or login) with ordered stops, addresses, package notes; print optional.
**I heard:** Managers send routes to drivers via in-app view (magic link or login); drivers see optimized stop order, addresses, and package notes; paper print remains optional backup.
**Needed?** Seed says routes can be sent to driver volunteers — completes map/route workflow after T6 routing build.
