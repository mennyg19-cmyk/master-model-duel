# Grill transcript — arm-02

## Turn 1
**Q:** Your "repeat last year's order" feature only works if we have last year's data — every customer's past orders, recipient addresses, and greeting-card messages. Where does that data live today, and can we get it out? ("Migration" just means copying old records into the new system so it starts with history instead of empty.)

**Options:**
- **A (Recommended):** It's in an existing system (e.g. a website, Shopify, QuickBooks, or a spreadsheet) that can export files — we migrate customers, addresses, and last year's orders before launch so repeat-order works in year one.
- **B:** The data exists but is messy or partly on paper — we migrate only customers and addresses, and repeat-order starts working from the new system's first season onward.
- **C:** There is no usable historical data — the new site starts empty, and repeat-order becomes a year-two feature.
- **D:** Something else — tell me what system you use now and what it can export.

**User:** A — Data is in an existing system that can export, but it is messy and will need cleanup to match the new data schema before migration.
**I heard:** Exportable historical data exists (customers, addresses, orders, greeting cards); launch includes a migration with manual cleanup/normalization to fit the new schema so repeat-order can work in year one.
**Needed?** The repeat-order flow, item replacement mapping, and browsable prior-year catalogs all assume historical data exists; whether and how it can be imported changes the launch scope, the data model, and whether a whole flagship feature ships in year one.

## Turn 2
**Q:** How big is a typical season? Roughly how many orders come in, how many individual packages go out, and how many staff/volunteers are working at once during the crunch (the last week or two before Purim)? A rough guess is fine — this decides how much the system has to handle at peak and how simple each screen must stay.

**Options:**
- **A (Recommended):** Small-to-mid: a few hundred orders (say 200–800), roughly 1,000–3,000 packages, 3–6 staff at once during crunch — simple screens, one shared order queue, no heavy concurrency handling needed.
- **B:** Larger: 1,000+ orders, 5,000+ packages, 10+ people working at once — we need batch tools, stricter concurrency handling, and faster bulk printing from day one.
- **C:** Tiny: under 200 orders, mostly one or two people entering everything — optimize for a single-operator flow and keep every screen minimal.
- **D:** Not sure — here are last year's rough numbers: ___ orders, ___ packages, ___ people.

**User:** B — Larger: 1,000+ orders, 5,000+ packages, 10+ people working at once during crunch — need batch tools, stricter concurrency, faster bulk printing from day one.
**I heard:** Peak season is large-scale (1000+ orders, 5000+ packages, 10+ concurrent staff); system must support batch operations, concurrency, and high-volume printing from launch.
**Needed?** Peak volume and number of simultaneous users determine the production/fulfillment tooling (batch printing, queue design, concurrency), and over- or under-building for scale is the most expensive mistake to reverse.

## Turn 3
**Q:** For shipping, you want the site to compare FedEx/UPS prices, charge the customer the higher quote, and actually ship with the cheaper carrier. To do that we need live rate quotes and label printing from real carrier accounts. What do you have today — do you already have FedEx and/or UPS business accounts, or do you use a shipping service like ShipStation, Pirate Ship, or EasyPost that handles both? (These services sit between you and the carriers: one login, rates from all carriers, and discounted nonprofit-friendly pricing.)

**Options:**
- **A (Recommended):** We'll connect through one shipping aggregator (e.g. EasyPost or Shippo) — it gives live rates from FedEx, UPS, and USPS in one integration, prints labels, and works whether or not you already have your own carrier accounts. Simplest to build and maintain.
- **B:** We already have our own FedEx and UPS business accounts with negotiated rates — integrate directly with both carriers' APIs so we keep our discounts.
- **C:** We currently use a shipping tool (ShipStation, Pirate Ship, etc.) — tell me which one, and we integrate with that so the workflow the staff knows stays the same.
- **D:** No accounts or tools yet — we ship at retail rates today; help us pick the cheapest setup as part of this project.

**User:** Not sure — we have B today (own FedEx and UPS business accounts with negotiated rates). Leaning toward A (aggregator like Shippo) for simpler setup/maintenance, unless direct dual-carrier integration isn't much harder. Prefer keeping our own rates/accounts connected through Shippo or similar rather than pure retail aggregator rates.
**I heard:** Existing FedEx/UPS business accounts; target architecture is likely one aggregator (Shippo/EasyPost-class) with org carrier accounts connected for negotiated rates + multi-carrier rate-shop/labels — direct dual API (B) is fallback if aggregator path doesn't fit. **OPEN:** final vendor choice (Shippo vs EasyPost vs direct) pending orchestrator/builder input on maintenance cost.
**Needed?** Rate-shopping + label printing is a major integration; choice affects build complexity, ongoing ops, and whether nonprofit negotiated rates flow through checkout.

## Turn 4
**Q:** Credit cards are the only payment method on the website, so we need a card processor — the service that actually charges the card and deposits the money in your bank account. Do you already take cards through something today (a processor tied to your current site, a nonprofit platform, a card swiper), or are we free to pick one? At 1,000+ orders the processing fees are real money, so this choice matters. Also: at checkout, do we charge the card immediately, or only when the order ships/delivers?

**Options:**
- **A (Recommended):** Pick a modern processor like Stripe (nonprofit discount available) — charge the full amount immediately at checkout. Simplest to build, staff never touch card handling, refunds are one click if an order changes.
- **B:** We already have a merchant account / processor we must keep (tell me which one) — integrate with that so the money keeps flowing to the same place and fees stay as negotiated.
- **C:** Charge only when the order is fulfilled (authorize now, capture later) — customers aren't billed for canceled orders, but authorizations expire after ~7 days, which is risky for orders placed weeks before Purim.
- **D:** Something else — e.g. a donation platform we already use that also processes payments; tell me what it is.

**User:** A — Stripe (or similar modern processor); charge full amount immediately at checkout.
**I heard:** Frontend checkout uses Stripe with immediate capture; staff never handle card data; refunds available when orders change; nonprofit discount path acceptable.
**Needed?** Payment processing is the other major external integration besides shipping; the processor choice drives checkout build, refund handling for staff-switched orders, fee costs at 1,000+ order volume, and whether an existing merchant account must be preserved.

## Turn 5
**Q:** You described the manager's side of delivery well — a map where routes are built and ordered by quickest path via Google. But what does the volunteer driver actually get in their hands? This decides whether we build a simple handoff or a whole driver app, and whether the office knows in real time which packages were delivered.

**Options:**
- **A (Recommended):** A link sent to the driver's phone that opens a simple mobile web page: the stop list in order, tap an address to navigate in Google Maps, tap "Delivered" per stop so the office sees live progress. No app to install — works for any volunteer with a smartphone.
- **B:** Low-tech handoff: the system generates a printed route sheet plus a Google Maps link with all stops pre-loaded. Drivers mark deliveries on paper; office marks orders delivered when the driver returns. Simplest to build, no live tracking.
- **C:** Full driver experience: driver logs in, sees assigned routes, live status updates, photo proof of delivery, and automatic customer notifications ("your package was delivered"). Most capable, but the biggest build and hardest for casual volunteers.
- **D:** Something else — tell me how drivers get their assignments today and what the office needs to know while they're out.

**User:** A — Mobile web link for drivers (stop list, navigate, tap Delivered for live office progress). Also support B as fallback: printed route sheet + Google Maps link for drivers without a smartphone.
**I heard:** Primary driver UX is no-install mobile web with per-stop Delivered taps; parallel low-tech path prints route sheet + maps link for non-smartphone volunteers; office can update from paper on return.
**Needed?** Driver experience scope — avoids over-building full app while supporting mixed volunteer tech comfort.

## Turn 6
**Q:** Let's pin down the nightly print run — the heart of your current workflow. Today someone prints packing slips, labels, and greeting cards for that day's orders and files them into folders (by location, single-item packages, etc.). At your scale that could be hundreds of pages a night. How should the new system produce this, and — critically — how does it decide what to print? Remember you asked for printing that does NOT mark anything as shipped, so the system needs its own way to remember "already printed" versus "shipped."

**Options:**
- **A (Recommended):** One "Tonight's Batch" button: the system gathers every order not yet printed, generates one big PDF already sorted into your filing groups (delivery area, shipping, single-item, etc.) with a cover sheet per group, and marks those orders "printed" (a separate flag from "shipped"). Reprinting any order or group is one click. Same button works for one order or five hundred.
- **B:** Same as A, but instead of one big sorted PDF, produce a separate PDF per filing group so different staff can print and file their own section in parallel — matters at 10+ people during crunch.
- **C:** Print on demand per order or per selection (staff check off orders in a list and print just those) — maximum control, but someone must remember what was printed; no automatic nightly batch.
- **D:** Something else — e.g. the batch also needs to reprint documents when staff switch a delivery method (shipping to delivery), or greeting cards print on special card stock so they must be a separate print job from slips and labels.

**User:** B — Separate PDF per filing group so staff can print and file in parallel during crunch; still marks "printed" separately from "shipped".
**I heard:** Nightly batch produces one PDF per filing group (delivery area, shipping, single-item, etc.); parallel print/file at scale; printed flag independent of shipped; reprint supported per group/order.
**Needed?** Core fulfillment print workflow at 1000+ order scale — matches current folder-based manual process.

## Turn 7
**Q:** You'll have 10+ people in the system at once during crunch — staff taking phone orders with check/cash payments, volunteers packing, managers building delivery routes, drivers out delivering. Who should be allowed to do what? For a team of over-60 users, every extra login step or permission screen is friction, but with cash and checks being recorded and delivery methods being switched, some control matters. How strict should we be?

**Options:**
- **A (Recommended):** Three simple roles: **Manager** (everything — routes, refunds, switching delivery methods, item setup, season open/close), **Staff** (take orders, record check/cash payments, run the nightly print batch), **Driver** (only their route link, no login needed). Everyone logs in with their own name so every payment and change is stamped with who did it — but no per-feature permission settings to manage.
- **B:** Even simpler: one shared staff login for everyone in the office plus the no-login driver links. Fastest for the team, but a recorded cash payment or a changed order can't be traced to a person.
- **C:** Finer control: the three roles from A, plus managers can toggle specific permissions per person (e.g. this volunteer can pack but not record payments). Most control, most screens to manage.
- **D:** Something else — tell me who's on the team and what you'd never want a volunteer to be able to touch.

**User:** C — Three base roles (Manager, Staff, Driver) plus managers can toggle specific permissions per person (e.g. pack but not record payments).
**I heard:** Role model is Manager / Staff / Driver with individual logins; managers can grant/revoke per-person permissions beyond the base role — finer control than fixed roles alone, more admin surface than A.
**Needed?** Auth, audit trail, and admin UX for 10+ concurrent staff — balances accountability (cash/check, method switches) with volunteer-appropriate access limits.

## Turn 8
**Q:** Let's talk greeting cards. Every recipient in an order can get a card, the nightly batch prints them, and repeat-order copies last year's messages forward. But how do cards actually work? When someone orders 15 packages for 15 recipients, does each card carry its own personal message, or one message for all? And physically — do cards print on special card stock as their own separate print job, or on regular paper alongside the packing slips? This shapes the order entry screens, the print batch, and what repeat-order copies.

**Options:**
- **A (Recommended):** One default greeting per order (e.g. "Happy Purim from the Goldbergs") that applies to every recipient, with the option to override the message on any individual recipient. Cards print as their own separate PDF per filing group (so staff can load card stock into the printer just for that job). Repeat-order copies both the default and any per-recipient overrides.
- **B:** Fully per-recipient: every recipient gets their own message typed individually — most personal, but slowest order entry at 15 recipients per order and the most for over-60 staff to manage on phone orders.
- **C:** One message per order, no per-recipient overrides — simplest screens and fastest entry, but a customer can't say something different to their rabbi than to their cousin.
- **D:** Something else — e.g. customers pick from preset messages, cards are preprinted and only the "from" name changes, or cards are handwritten today and should stay that way.

**User:** A — One default greeting per order with optional per-recipient overrides; cards print as separate PDF per filing group on card stock; repeat-order copies default + overrides.
**I heard:** Order-level default greeting applies to all recipients unless overridden per recipient; greeting cards are a distinct print job (separate PDF per filing group for card stock); repeat-order preserves default and per-recipient messages.
**Needed?** Order-entry UX, nightly print batch composition, and repeat-order copy behavior for greeting cards.

## Turn 9
**Q:** Let's nail down how a "season" works, because it touches three things you asked for: each year has its own catalog of items, the store shuts down off-season but people can still browse previous years' catalogs, and each new item can point at last year's item it replaces (so repeat-order knows what to swap). Who opens and closes a season, and what exactly do visitors see when the store is closed?

**Options:**
- **A (Recommended):** Seasons are first-class: a manager creates "Purim 2027," builds its catalog (setting each item's "replaces last year's X" link as they go), and flips the store between **Open** (ordering live) and **Closed** (site stays up, visitors can browse this and past years' catalogs with prices hidden or marked "last season," but no cart or checkout). Old seasons stay browsable forever, read-only. One switch, no scheduled dates to manage.
- **B:** Same as A, but the manager sets open/close dates in advance and the store flips automatically — less to remember during the crunch, but a stuck date at the wrong moment is confusing for an over-60 team.
- **C:** Simplest: off-season the site shows just a "See you next Purim" page with a photo gallery of past catalogs (no real browsable catalog pages). Least to build, but past-year browsing is just pictures.
- **D:** Something else — e.g. closed season should still collect email signups or donations, or past catalogs should show prices, or some items carry over unchanged between years.

**User:** A, with B fallback — Manager-controlled Open/Closed switch (A); optional scheduled open/close dates that auto-flip as a secondary feature (B).
**I heard:** Seasons are first-class with manager manual Open/Closed toggle; closed = browse-only (current + past catalogs, no checkout, prices hidden or "last season"); past seasons read-only forever; optional auto open/close dates as add-on without replacing manual switch.
**Needed?** Season lifecycle, catalog-per-year model, off-season public site, and repeat-order replacement links — core data model decision.

## Turn 10
**Q:** The delivery map is where managers build routes — and you said it should also show shipping orders that happen to sit near a planned delivery stop, so a manager can pull a box off the shipping pile and hand it to the driver instead (saving the shipping cost). Let's pin down how that reroute actually works on screen and what happens to the order behind the scenes. When a manager spots "123 Main St ships, but our driver already passes 124 Main St" and clicks it — what should the system do?

**Options:**
- **A (Recommended):** The map shows delivery stops as one color and nearby unshipped shipping orders as another (only orders not yet labeled/shipped appear). Manager clicks a shipping order → "Add to this route" → the system switches the order's method from shipping to delivery, adds the stop to the route, flags it for the print batch (new packing slip group), and notes the switch on the order history. If a shipping label was already bought, the system warns and won't switch until the label is voided. No refund to the customer — they paid the shipping price and the org pockets the savings.
- **B:** Same as A, but the customer is automatically refunded the difference between what they paid for shipping and the (usually cheaper or free) delivery — fairer to customers, but adds Stripe partial-refund handling and an extra decision for staff on every switch.
- **C:** The map only *suggests* — it highlights nearby shippable orders, but the actual method switch happens on the order page as a separate deliberate step (manager opens the order, changes method, then adds it to the route). Slower, but harder to fat-finger during crunch.
- **D:** Something else — e.g. "nearby" needs a specific radius (same street? half a mile?), or drivers should be able to accept/decline added stops, or some shipping orders must never be switched (out-of-town gifts the customer expects via FedEx tracking).

**User:** A, but even if a label was printed — if it wasn't shipped yet, cancel/void the label, switch method to delivery, add to route, and record the change. No customer refund; org keeps shipping savings.
**I heard:** Map shows delivery stops vs nearby unshipped (not yet shipped) shipping orders; one-click "Add to route" switches method, updates print batch, logs history; printed-but-not-shipped labels are auto-voided/cancelled as part of the switch (not blocked); no refund to customer.
**Needed?** Map UI, route building, shipping-label void integration, method switch + audit trail — flagship shippable-near-delivery reroute from seed.

## Turn 11
**Q:** Pickup is the one delivery option we haven't touched. Customers choose "pickup" at checkout and then come to the house to collect their packages. At 1,000+ orders, some meaningful pile of them will be pickups — and the house is also the warehouse where packing is happening. How should pickup actually work: when can people come, how does the customer know their order is ready, and what does the staff member at the door do when someone shows up?

**Options:**
- **A (Recommended):** Pickup window set per season by a manager (e.g. "pickups: the 3 days before Purim, 10am–8pm"). When an order's packages are packed, staff mark it "Ready for pickup" and the customer gets an automatic email/text. At the door, staff pull up a simple pickup list (search by name), hand over the packages, and tap "Picked up" — which stamps who released it and when. Unclaimed orders show on a report so someone can call before Purim.
- **B:** Simpler: no ready-notification. The site just tells customers the pickup days/hours at checkout; all pickup orders are packed by the window's start, staff check names off the same pickup list. Less to build, but people may show up before their order is packed.
- **C:** Scheduled slots: customers pick a specific day/time slot at checkout so the door isn't slammed at peak. Smooths traffic, but adds a scheduling screen for customers and staff, and no-shows still need handling.
- **D:** Something else — e.g. pickups happen at a different location than the packing house, someone else can collect on the customer's behalf, or today's pickup process works a certain way you want kept.

**User:** A, but pickup window for each order starts as soon as inventory is available for that order (not only at a fixed season window start). Ready notification + door pickup list + picked-up stamp + unclaimed report as in A.
**I heard:** Per-order pickup eligibility begins when that order's items are in stock/available; staff mark ready → auto notify customer; door list with search, handoff, "Picked up" audit; unclaimed report; season may still cap latest pickup hours but individual orders open for pickup when inventory allows.
**Needed?** Pickup workflow tied to inventory availability, notifications, and door-side fulfillment at scale.

## Turn 12
**Q:** Per-package delivery is your premium option — driven to the recipient's door "in the day or two before Purim," priced differently, and only allowed in certain zip codes. What we haven't pinned down is the timing promise: what exactly does the customer choose or get told at checkout about *when* their packages will arrive? This shapes checkout screens, how managers plan those crunch-day routes, and what happens when Purim week is slammed.

**Options:**
- **A (Recommended):** No customer choice — checkout simply says "delivered on [date] or [date]" (the one or two days before Purim, set per season by a manager). Managers freely assign every per-package order to whichever route/day works best. Simplest checkout, maximum routing freedom during crunch, and the customer promise is just "before Purim."
- **B:** Customer picks a delivery day (of the allowed one or two days) at checkout. Friendlier promise, but it constrains route building on the busiest days and needs per-day capacity limits so one day doesn't oversell.
- **C:** Same as A, plus the system sends the recipient/customer a "your package is out for delivery today" notification when the driver's route starts — no choice at checkout, but visibility on the day. Small add on top of the driver route flow you already chose.
- **D:** Something else — e.g. some zip codes get different delivery days, big orders (schools, shuls) need a scheduled time, or the delivery window should be longer than two days.

**User:** C — No customer day choice at checkout (manager-set Purim-week dates shown); managers assign routes freely; plus "out for delivery today" notification when driver route starts.
**I heard:** Per-package checkout shows allowed delivery days before Purim (manager-configured) without customer picking a slot; staff route assignment stays flexible; customer/recipient gets day-of notification when route begins — builds on mobile driver flow from Turn 5.
**Needed?** Per-package delivery promise at checkout, route planning constraints, and customer communication during Purim crunch.

## Turn 13
**Q:** Last piece: the address book. Every customer has one, recipients get added to orders from it, and repeat-order copies last year's recipients forward. But who maintains it, and how does it stay usable a year later? When staff take a phone order and the customer says "same as last year, but the Cohens moved" — can staff edit the customer's address book directly? And when repeat-order pulls recipients whose addresses are a year old, do we just trust them, or make the order taker confirm each one?

**Options:**
- **A (Recommended):** The address book belongs to the customer but staff can fully view and edit it from the POS (add recipients, fix addresses, delete stale entries) — every edit stamped with who made it. During repeat-order, the confirmation middle-page (from your seed) shows recipients alongside the item replacements so the order taker verbally confirms addresses in the same pass — no separate address-review step. Customer edits on the website update the same single address book.
- **B:** Staff can add new recipients to an order but can't edit the customer's saved address book — edits only happen when the customer does it themselves online. Cleaner ownership, but phone-order fixes ("the Cohens moved") create duplicate entries instead of correcting the saved one.
- **C:** Same as A, plus a shared organization-wide recipient list for common destinations (the local shuls, schools, rabbis many customers send to) that staff maintain once and any order can pull from — avoids 200 customers each typing the same shul address slightly differently, but adds a "shared vs personal" concept to the UI.
- **D:** Something else — e.g. address books should be validated against a postal-address service on entry, recipients should carry a "confirmed this year" flag, or customers share address books within a family.

**User:** A — Customer-owned address book; staff can fully view/edit from POS with audit stamp; repeat-order middle page confirms recipients alongside item replacements; website and POS share one book.
**I heard:** Single address book per customer editable by customer (web) and staff (POS) with who-edited audit; repeat-order review page confirms addresses + replacements together; no separate staff-only shadow book.
**Needed?** Address book ownership, POS edit rights, repeat-order trust/confirmation — core order-flow seed requirement.
