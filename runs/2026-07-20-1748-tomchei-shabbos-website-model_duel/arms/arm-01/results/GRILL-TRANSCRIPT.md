## Turn 1
**Q:** For the first Purim season, how much should the website control fulfillment after an order is placed?
**Options:**
- A — Print-first: the website creates packing slips, labels, and greeting cards, but the existing folders and paper process remain the main way staff track the work.
- B — Hybrid (**Recommended**): keep all current printing and allow printing without marking anything shipped, while also offering a few optional, simple stages such as New, Printed, Packed, and Sent or Picked Up. Staff can move from paper to the website gradually.
- C — Fully digital: the website assigns and tracks every package through packing and delivery, with paper used only as a backup.
**User:** B — Hybrid: keep all current printing and allow printing without marking anything shipped, while also offering optional simple stages (New, Printed, Packed, Sent/Picked Up). Staff can move from paper to the website gradually.
**I heard:** First season stays print-first with optional simple digital stages; nothing is marked shipped just because documents were printed; volunteers can adopt tracking at their own pace.
**Needed?** This choice determines whether the first release should preserve the current paper workflow, support a gradual transition, or replace it, which changes the fulfillment design throughout the system.

## Turn 2
**Q:** When one customer sends several items to the same recipient and address, how should staff pack and track them?
**Options:**
- A — One package per item: every item gets its own packing slip, greeting card, label, and status, even when several items go to the same person.
- B — Combine when possible (**Recommended**): group items for the same recipient, address, delivery method, and greeting into one package by default, but let staff split them when needed. Track and print by package, while keeping the full customer order linked.
- C — Staff decide every time: keep each item separate in the system until staff manually choose which items belong in each package.
**User:** B — Combine when possible: group items for same recipient/address/delivery/greeting into one package by default; staff can split when needed.
**I heard:** Default is one package per recipient grouping; staff override to split; track and print by package while order stays linked.

## Turn 3
**Q:** If staff switch a paid package from shipping to volunteer delivery, or from delivery to shipping, what should happen to the delivery charge the customer already paid?
**Options:**
- A — Keep the original charge: the organization keeps any savings or covers any extra cost, and staff only change how the package is sent.
- B — Adjust it automatically: refund savings or collect the extra amount whenever the delivery method changes.
- C — Ask a manager (**Recommended**): show the price difference, let a manager choose whether to keep, refund, or collect it, and record the choice.
**User:** A — Keep the original charge. This is a backend feature for the org to save on shipping fees while the customer has already been charged; staff switch fulfillment method without adjusting what the customer paid.
**I heard:** Delivery-method switches (ship ↔ volunteer delivery) never change the customer’s paid delivery charge; savings stay with the org; no auto refund/collect — backend cost-optimization only.
**Needed?** Determines payment/refund logic when staff re-route packages to save shipping — core to the “send shippable box with delivery volunteer” workflow from the seed.

## Turn 4
**Q:** For production, how much inventory detail should staff track while assembling the gift packages?
**Options:**
- A — Finished packages only: staff enter how many complete packages are ready, without tracking the items used to make them.
- B — Ingredients and finished packages (**Recommended**): each gift package has a simple list of what goes inside; when staff record an assembly batch, the system uses those supplies and adds the completed packages to stock.
- C — Supplies only: track the items on hand and calculate how many packages could be made, but do not record completed-package stock separately.
**User:** B — Ingredients and finished packages, but for now ingredients should be hidden and optional; don't overload users. Track finished packages in the main flow; ingredient/supply tracking available when ready but not forced at launch.
**I heard:** Data model supports ingredients + finished packages (BOM + assembly batches), but v1 UX shows finished-package counts only; ingredient tracking is off/hidden by default and can be enabled later without redesign.
**Needed?** Sets production/inventory scope for v1 vs later — critical for not overwhelming 60+ volunteers while keeping the seed's in-house production requirement buildable.

## Turn 5
**Q:** When repeating last year's orders, what should happen if an old item has no replacement set for this year's catalog?
**Options:**
- A — Leave it out and warn: copy the rest of the order, remove that item, and clearly tell the order taker what was left out.
- B — Require a choice on the review page (**Recommended**): copy the order into a draft, flag the item, and make the order taker choose a current item or remove it before the order can be submitted.
- C — Stop the whole repeat: do not create the draft until a manager sets a replacement for every old item.
**User:** B — Require choosing a current item or removing it on the review page. Also want smart default replacements based on price when no explicit mapping exists.
**I heard:** Repeat-order drafts flag unmapped old items; order taker must pick a current item or remove before submit; system suggests price-matched replacements when admin hasn't set a manual replacement mapping.
**Needed?** Defines repeat-order UX, replacement-mapping admin workflow, and fallback logic — core seed feature.

## Turn 6
**Q:** What should happen when a recipient's address is outside the zip codes allowed for per-package delivery?
**Options:**
- A — Block it for everyone: do not offer per-package delivery, and require shipping or pickup instead.
- B — Block customers, allow a manager override (**Recommended**): the website explains that delivery is unavailable and offers shipping or pickup, while the backend lets a manager approve an exception and records who approved it.
- C — Accept a delivery request for staff review: let the customer place the order with delivery pending, then have staff approve it or contact the customer to switch methods.
**User:** A — Block per-package delivery for out-of-area zips for everyone; require shipping or pickup instead. No manager override path.
**I heard:** Per-package delivery is hard-blocked outside allowed zip list at order entry (frontend and backend); customer must pick shipping or pickup; no pending-review or manager exception workflow.
**Needed?** Zip-gate rules for pre-Purim per-package delivery — simplifies v1 vs manager override complexity.

## Turn 7
**Q:** How should customers be charged for bulk delivery compared with per-package delivery?
**Options:**
- A — Charge one bulk-delivery fee for each destination, while charging a separate per-package delivery fee for every recipient package (**Recommended**).
- B — Charge by package for both types, but use a lower price per package when they all go to one bulk destination.
- C — Let staff quote each bulk delivery, while per-package delivery uses fixed prices set for each delivery area.
**User:** A — One bulk-delivery fee per destination; separate per-package delivery fee for every recipient package.
**I heard:** Bulk delivery pricing is per destination (one fee); per-package delivery charges per recipient package; distinct fee models for the two delivery types.
**Needed?** Checkout and backend pricing rules for bulk vs per-package delivery — affects fee configuration, order totals, and staff method-switch recalculation.

## Turn 8
**Q:** How should the backend limit what different staff members are allowed to change?
**Options:**
- A — Everyone has the same access: any staff member can enter orders, take payments, manage fulfillment, change prices and catalogs, and manage other users.
- B — Staff and managers (**Recommended**): regular staff can enter orders, record cash or check payments, print documents, and update fulfillment; managers can also change prices, catalogs, delivery rules, inventory settings, and user access.
- C — Fully custom permissions: managers choose each action that every staff member can or cannot perform.
**User:** B for defaults, C for more manual customization — start with Staff vs Manager roles (B), but managers can override/toggle specific permissions per person when needed (C-style customization).
**I heard:** Default two-tier model: Staff (orders, cash/check, print, fulfillment) vs Manager (+ prices, catalogs, delivery rules, inventory, users); optional per-person permission overrides for managers without requiring full custom matrix for everyone.
**Needed?** Auth/RBAC scope — simple defaults for 60+ volunteers with escape hatch for fine-grained control when a specific person needs limited access.

## Turn 9
**Q:** For bulk delivery, who should decide when it arrives before Purim?
**Options:**
- A — Staff choose the timing (**Recommended**): the customer selects bulk delivery but not a date; staff group deliveries into efficient routes, set the date or time window, and notify the customer.
- B — Customer chooses: the customer selects an available date and time window during checkout.
- C — Customer requests, staff confirm: the customer gives a preferred date or window, but staff must approve or change it before it is final.
**User:** A — Staff choose bulk delivery timing; customer selects bulk delivery only; staff route, set date/window, and notify customer.
**I heard:** Bulk delivery has no customer-selected appointment at checkout; staff batch into routes, assign delivery date/time window, and notify customers after scheduling.
**Needed?** Bulk delivery scheduling UX and route-building workflow — staff-driven vs customer self-scheduling.

## Turn 10
**Q:** When entering one order for several recipients, how should the customer or staff member build it?
**Options:**
- A — One recipient at a time (**Recommended**): add or choose a person from the address book, select that person's gift, delivery method, address, and greeting card, then move to the next recipient.
- B — Gifts first: choose a gift and quantity, then assign each copy to a recipient and fill in that recipient's delivery details and greeting card.
- C — Use a list: enter recipients in a table and choose each person's gift, delivery method, address, and greeting card in separate columns.
**User:** Custom — E-commerce cart feel: main panel with catalog items, add to cart, qty, etc. When adding an item to cart, prompt whether to send to (1) a recipient already on this order, (2) a recipient from the address book, or (3) a new recipient. Every new recipient added should be saved to the customer's address book.
**I heard:** Order entry is catalog/cart-first (not recipient-first or table-first); each cart line is tied to a recipient via a three-way picker (on-order / address book / new); new recipients auto-save to the customer's address book; same pattern for frontend and backend POS.
**Needed?** Core order-entry UX — per-recipient-from-ground-up as seed requires, optimized for familiar e-commerce flow for 60+ users and phone-order staff.

## Turn 11
**Q:** When adding a gift for a recipient, how should the greeting card message be entered and reused?
**Options:**
- A — Write it each time: start with a blank greeting card for every recipient and every new order.
- B — Remember it for that recipient (**Recommended**): start with the recipient's last greeting, let the customer or staff edit it for this gift, and save the final version for repeat orders.
- C — Choose from saved messages: let the customer keep a small list of reusable greetings, choose one for each recipient, and edit it when needed.
**User:** B — Remember each recipient's last greeting as the default; customer/staff can edit per gift; save final version for repeat orders.
**I heard:** Per-recipient greeting memory — pre-fill from last year's/last order's message for that recipient; editable at order time; persisted for repeat-order copy; complements order-level default from arm-02 Turn 8 pattern.
**Needed?** Greeting card data model tied to address-book recipients and repeat-order flow.

## Turn 12
**Q:** When the fundraiser is closed for the off-season, what should visitors be able to see?
**Options:**
- A — Last year's catalog only: show the most recent catalog for browsing, with ordering turned off.
- B — A catalog archive (**Recommended**): let visitors choose and browse any previous year's catalog, clearly label every item as not currently for sale, and turn off the cart and checkout.
- C — Current page only: keep the latest catalog page visible with ordering turned off, but do not provide older catalogs.
**User:** B — Full catalog archive: browse any previous year's catalog off-season; items clearly marked not for sale; cart and checkout disabled.
**I heard:** Off-season public site offers year-picker archive of all past catalogs read-only; no ordering; items labeled as not currently for sale; aligns with per-year catalog model and repeat-order history.
**Needed?** Off-season public UX and season/catalog navigation — complements manager Open/Closed season control.

## Turn 13
**Q:** When the map shows a package marked for shipping near a volunteer delivery route, how should staff move it onto that route?
**Options:**
- A — Suggest and confirm (**Recommended**): show nearby shipping packages on the map; a manager selects one, confirms the change, and the system switches it to volunteer delivery and adds it as a route stop.
- B — Add automatically: when staff build a route, automatically switch and add every shipping package within a set distance.
- C — Show only: display nearby shipping packages on the map, but require staff to change the delivery method and add the route stop separately.
**User:** A — Suggest and confirm on map: manager selects nearby shipping package, confirms switch to volunteer delivery and add as route stop.
**I heard:** Map surfaces nearby unshipped shipping packages; manager one-click confirm switches method, adds route stop, logs change; no auto-reroute; consistent with keep-original-charge (Turn 3) and void printed-not-shipped labels when applicable.
**Needed?** Map UI and shippable-near-delivery reroute workflow — flagship seed requirement.
