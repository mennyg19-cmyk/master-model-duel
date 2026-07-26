# Grill transcript — arm-04 (late join, live)
Seed: shared/GRILL-SEED.md

---

## Turn 1 — Frame the target and the Purim deadline

**Agent:**

Here is what I think you are asking for, in my words:

- A seasonal storefront for a non-profit Purim mishloach manos fundraiser, with one catalog per year, an off-season shutdown that still lets people browse past years, and a POS/back-office for staff taking orders by phone or in person.
- Order entry where each item can go to its own recipient and its own address — built in from the start, front end and POS both — with a per-customer address book, greeting cards, and a repeat-last-year flow that maps retired items to their replacements and shows a confirmation page before the cart is loaded.
- Four fulfillment types with their own rules: shipping, pickup, bulk delivery any time before Purim, and per-package delivery in the last day or two (different pricing, allowed zip codes only). Staff can switch an order between types — e.g. move a shippable box onto a delivery route that is already going next door.
- In-house production: inventory of components and finished packages, and a production setup so the house can build and track what it packs.
- Fulfillment that reproduces the current paper night: print packing slips, labels and greeting cards for the day's orders, sorted into the same folder buckets (location, single-item, etc.), and printing must never force an order to be marked shipped — so the team can stay manual as long as they want.
- Later-stage automation: a map where a manager picks delivery stops, builds a route, sends it to a volunteer driver, gets Google to order the stops, and sees nearby shippable orders on the same map; plus carrier rate shopping that quotes the customer the higher of FedEx/UPS and ships on the cheaper one. Credit card only on the front end; cash and check allowed in the back office.

**Question:** Is that the right target — and of all of it, what has to be actually working in the hands of your over-60 staff for **this coming Purim**?

**Options:**

- **A.** All of it, one build, live this Purim. Nothing gets deferred.
- **B. (Recommended)** Split it in two. **Must be live this Purim:** yearly catalog + storefront with off-season browsing, order entry on both front end and POS with per-item recipient/address/greeting card from the ground up, address book, repeat-order with replacement-item confirmation, the four fulfillment types and their pricing/zip rules, in-house inventory and production, and the nightly print pack with print-without-marking-shipped. **Next season (design for it now, do not build it yet):** the map route builder with Google route optimization and driver hand-off, and live FedEx/UPS rate shopping — this Purim, shipping is a flat or table rate that staff can override, and routes are still built by hand.
- **C.** Flip B. The map routing and the rate shopping are the whole point of paying for this — build those first and let the office keep doing order entry and printing the way it does now.
- **D.** My summary above is wrong or incomplete. Correct me: ______

**Why it matters:** Purim is a hard, immovable date and this is a small volunteer team, so what lands in the "must be live" bucket decides the data model, how much of the paper workflow I keep intact as a fallback, and whether I spend the build budget on carrier and Google integrations or on the order-entry and printing screens the staff touch every night.

**User:** A — All of it, one build, live this Purim. Nothing gets deferred.

**I heard:** My summary of the target is correct, and the scope is the whole thing in one build, in production for this coming Purim. Nothing on the list is a "next season" item — the map route builder with Google route optimization and driver hand-off, and live FedEx/UPS rate shopping (quote the higher rate, ship the cheaper one) are in scope for this season alongside the catalog, dual order entry, address book, repeat-order with replacement confirmation, the four fulfillment types with their pricing and zip rules, in-house inventory and production, and the nightly print pack. I will plan against a fixed Purim date with no scope relief, which means the flex has to come from build sequencing and from external dependencies being lined up early.

---

## Turn 2 — Last year's data, and whether repeat-order can actually work in year one

**Agent:**

Taking you at your word on A: repeat-order is now on the critical path for this season, not a later nicety. But repeat-order only exists if last year's information can get into the new system — customers, their address books, who they sent to, what the greeting cards said, and what they ordered. Same for "browse previous years' catalogs": that needs last year's item list, and the replacement-item mapping needs last year's items to point new items at. So before I design any of it, I need to know what actually exists today and in what shape.

**Question:** Where does last year's information live right now, and what can you realistically hand me?

**Options:**

- **A. (Recommended)** It is in an existing system (Shopify, WooCommerce, QuickBooks, a donor CRM, an old custom site — tell me which) and you can get me a real export. I import customers, address books/recipients, greeting card text, last year's orders, and last year's catalog. Repeat-order and previous-year browsing both work on day one, and every new item gets a "replaces item X from last year" field pointing at real records.
- **B.** It is spreadsheets and paper — no clean system export. We import what is tabular (customers, addresses, maybe last year's item list) and re-key the rest by hand before the season. Repeat-order works off imported recipients and a hand-built replacement map; full prior-order history may be thin.
- **C.** Nothing usable comes across. Year one starts empty: the repeat-order flow and the previous-year catalog page ship as working code but sit dark until next Purim, when this system is the one holding the history.
- **D.** Something else / a mix — tell me what you have: ______

**Why it matters:** This is the single dependency I cannot code around. If the export is thin or late, repeat-order and prior-year browsing are features with nothing to chew on during your busiest weeks, and I would rather know now — while I can shape the data model around the real export and start the cleanup early — than discover it in the last week before Purim.

**User:** A — have Excel files.

**I heard:** Last year's data exists and will be handed to me as Excel spreadsheets — a file drop, not a live connection to Shopify/Woo/QuickBooks or any system API. So the migration is a one-time import job I write against your actual columns, not an integration. I am planning for repeat-order and previous-year catalog browsing to work on day one off that import: customers, address books, recipients, greeting card text, last year's orders, and last year's item list, with new items carrying a "replaces item X from last year" pointer into the imported catalog.

Open item, not a question for you to answer now: send me the actual workbooks (or just the header rows and a few sample lines of each) early. Real Excel exports are usually messier than they look — merged cells, one row per order instead of one per line item, addresses in a single blob, names spelled three ways — and I would rather shape the import and the cleanup pass around your real files than a guess. I will also assume the import is re-runnable, so we can load a rough version now and reload a cleaned version later without starting over.

---

## Turn 3 — The nightly print run, and what printing does to an order

**Agent:**

This is the part of the seed you were most specific about, so I want to get it exactly right rather than approximately right. Today one staffer prints the day's packing slips, labels and greeting cards at night, carries them in, and files them into folders by location, single-item packages, and so on. You also said printing must never force an order to count as shipped, so the team can stay manual as long as they like.

**Question:** When she sits down at night to print, what should the system hand her — and what should the act of printing do to the order?

**Options:**

- **A. (Recommended)** A "print run" screen. She picks the day (defaulting to orders created today), and the system does the filing for her: it groups the orders into the same buckets she sorts by hand — bulk delivery grouped by area, per-package delivery, shipping, pickup, and single-item packages — and gives her one PDF per bucket, with each order's packing slip, labels and greeting cards kept together in the same sequence, so the stack comes off the printer already in folder order. Printing only records "printed on [date] by [staffer]." It does not mark anything packed, shipped or delivered — those stay separate buttons a human presses. Reprints are allowed any time and are marked as reprints.
- **B.** Same grouping and same PDFs, but printing does move each order to a "printed" state, so the next night's run automatically skips it and nothing prints twice by accident. A staffer can undo that if she needs to reprint. Still nowhere near "shipped."
- **C.** Keep year one closer to today: one PDF of the day's orders in order-number sequence, no bucket logic, and she keeps sorting into folders by hand exactly as she does now. Less to learn, less that can be wrong.
- **D.** None of these match your night — walk me through what she actually does, in order: ______

**Why it matters:** This is the screen your team touches every single night in the busiest weeks of the year, and it is where "dumb, simple, easy to use" either holds or collapses. Whether printing changes an order's status also decides how many states an order has and how much undo I need to build — and getting that wrong is how a volunteer accidentally marks forty boxes shipped that are still sitting on the dining room table.

**User:** A — Print-run screen with bucket PDFs; printing only logs printed, does not mark packed/shipped; reprints allowed.

**I heard:** The system does the sorting she does by hand today. A print-run screen defaults to the day's new orders, splits them into her folder buckets (bulk delivery by area, per-package delivery, shipping, pickup, single-item packages), and emits one PDF per bucket with each order's packing slip, labels and greeting cards kept adjacent and in the same sequence, so the printed stack is already in filing order. Printing is a pure side-effect-free record: it writes "printed on [date] by [staffer]" and touches nothing else. Packed, shipped and delivered remain separate, deliberate human actions, which is what makes the slow migration to automation possible — the team can run the whole season on paper and the system never gets ahead of them. Reprints are unrestricted and stamped as reprints, so nothing is ever locked behind "we already printed that."

Design consequence I am carrying forward: an order's printed history is an event log, not a status, and the print run is re-runnable and idempotent from the system's point of view. I will also need the bucket definitions to be data, not hardcoded, since the folder scheme is theirs and will drift year to year.

---

## Turn 4 — What happens to the money when staff move a package between delivery types

**Agent:**

You gave me two rules that collide, and I want you to decide the collision rather than me guessing. Rule one: the front end takes credit cards only, and shipping is quoted by rate shopping — you show the higher of FedEx/UPS and ship on the cheaper one, so the organization keeps the spread. Rule two: staff can move a package between fulfillment types after the fact — the shippable box going to 123 Main Street rides along with the volunteer already delivering to 124 Main Street. That second move can change the real cost by a lot, and per-package delivery is priced on its own scale and only allowed in certain zip codes. The customer's card was already charged at checkout.

**Question:** When staff switch an order's delivery type after payment, what happens to what the customer paid — and do the per-package zip rules bind staff the way they bind the website?

**Options:**

- **A. (Recommended)** Price is locked at checkout. What the customer paid is what they paid, and switching delivery type never automatically refunds or re-charges. Savings from riding a package along on a delivery route stay with the organization as fundraising margin — the same logic as quoting the higher carrier rate and shipping on the cheaper one. If a manager genuinely wants to adjust a specific order, there is one explicit "adjust total" action that requires a reason and either refunds to the card or sends a payment link. The zip restriction is a website rule, not a physical law: staff can put any address on any route, and the system warns rather than blocks, because staff know things the rules do not.
- **B.** The customer always pays true cost. Switching recalculates the order against the new type's pricing and automatically refunds the difference to the card (or requests the extra). Nobody is ever charged for shipping that did not happen.
- **C.** Switching is a manager-only action and the system offers the choice each time: keep the difference as a donation, or refund it — logged either way, decided per order.
- **D.** Different — tell me how you want it: ______

**Why it matters:** This one decision reaches further than it looks. It determines whether an order carries one price or a price that can move underneath it, whether I need refund plumbing and a card-on-file relationship with your payment processor from day one, whether the zip and pricing rules live in one shared engine or split into "front end rules" and "staff can do anything," and what your books look like when the season closes. It is also the difference between a volunteer being blocked at 11pm by a rule she does not understand and a volunteer seeing a warning she can read and click past.

**User:** A — Price locked at checkout; no auto refund on mode switch; savings stay with org; explicit adjust-total with reason; zip rules warn staff, don't block.

**I heard:** The order total is set once, at checkout, and nothing that happens afterwards in the warehouse moves it. Switching a package between shipping, pickup, bulk delivery and per-package delivery is a fulfillment decision, not a financial one, so it never triggers an automatic refund or extra charge. When a shippable box rides along with a volunteer who is already going to the next house, the saved shipping cost becomes fundraising margin — consistent with quoting the higher carrier rate and shipping on the cheaper one. The only way money moves after checkout is a manager deliberately using an "adjust total" action with a required reason, which can refund to the card or send a payment link. And the per-package delivery zip restriction is a storefront rule: it stops a customer from buying something you cannot deliver, but staff building routes get a warning they can read and click past, never a hard stop.

Design consequences I am carrying forward: the price the customer paid is immutable and stored on the order as captured amounts, separate from actual fulfillment cost, so the two can diverge and the difference is reportable as margin; every adjustment is an audited event with an actor and a reason rather than an edit-in-place; the pricing and eligibility rules live in one engine with two enforcement levels (storefront = block, staff = warn), not two copies that drift apart.

---

## Turn 5 — What inventory actually counts, and what happens when you run out

**Agent:**

We have not touched the warehouse side yet, and it is the part with the least detail in what you told me. You said the packages are assembled in house, so inventory has to be built in house and there must be a production setup. That sentence can mean two very different systems, and the fork matters most on the night you run out of something.

**Question:** What should the system actually count — the finished baskets, or the parts that go into them — and what should happen when a customer tries to buy one you cannot build?

**Options:**

- **A. (Recommended)** Count both, with recipes optional. Every item can have a recipe listing what goes into it (so many jars of honey, one box, one bow, three chocolates), and the system tracks component stock and finished-package stock separately. A production screen runs a build — "assemble 50 of the Deluxe basket" — which consumes components and produces finished packages, so you always know both what is on the shelf and what you could still make. The storefront sells against what can still be built and hard-stops when that hits zero, marking the item sold out. Staff taking an order in the back office get a warning instead of a stop, because they can pick up the phone and order more chocolate. Items with no recipe are just a plain count, so you are never forced to write recipes for things that do not need them.
- **B.** Count finished packages only. A staffer enters "we built 200 Deluxe baskets," orders draw that number down, and the storefront shows sold out at zero. No recipes, no components, no build runs — the parts are tracked in her head and on the shopping list, exactly as they are today. Far less to teach, far less to keep accurate.
- **C.** Track everything for information, block nothing. Counts are visible on a dashboard and on the print run, and the production screen tells you "you are 40 Deluxe baskets short of what has been ordered," but no sale is ever refused — you would rather take the money and sort it out than turn a donor away in the last week.
- **D.** Different — describe how you decide what to build and when you stop selling: ______

**Why it matters:** This decides the shape of the inventory tables, whether I build a production module or a number field, and how much data entry your team owes the system before the season opens — a recipe for every item is real work for a small volunteer team, and a recipe that drifts out of date is worse than no recipe. The sold-out behaviour is the sharper end: hard-stopping protects you from promising baskets you cannot build in the last 48 hours, and never stopping protects you from turning away a donor at the moment they are ready to give. Those pull in opposite directions and only you can say which failure you would rather explain.

**User:** A — Count both (optional recipes); production build runs; storefront hard-stops sold out; staff POS warns only.

**I heard:** There are two stock levels, not one. Components (jars, boxes, bows, chocolates) and finished packages are counted separately, and an item's recipe is the bridge between them — but recipes are optional, so an item that is simply bought and resold is just a number and nobody has to write a recipe for it. A production screen runs builds: "assemble 50 Deluxe baskets" consumes the components and creates finished packages, which gives you both what is physically on the shelf right now and what you could still make from parts on hand. The storefront sells against buildable quantity and hard-stops at zero with a sold-out state, so the public can never order a basket you have no path to producing. Staff in the back office get a warning instead of a block, because they can order more chocolate and know whether it will arrive in time.

Design consequences I am carrying forward: buildable quantity is a derived number (finished stock plus the minimum a recipe allows from components, less what is already committed to unfulfilled orders), so it needs to be computed consistently and not drift; stock moves are ledger entries — received, consumed by build, produced by build, committed to order, fulfilled, adjusted with a reason — rather than a mutable count someone overwrites; and the same buildable number feeds two different enforcement levels, hard-stop on the storefront and warn in the POS, which is the same one-engine-two-levels pattern we settled on for the zip rules in Turn 4.

---

## Turn 6 — The outside accounts, which are the only thing I cannot build my way around

**Agent:**

You told me nothing gets deferred, and three pieces of what you asked for do not run on code I write — they run on accounts somebody has to open in the organization's name. Rate shopping needs live FedEx and UPS access. The route map needs a Google Maps Platform key with billing enabled. Card payments need a merchant account approved for a non-profit. Approvals take weeks, they are outside my control, and there is no clever engineering that substitutes for a credential that has not been issued.

**Question:** How do you want to get carrier, maps and payment access — and who in the organization owns those accounts?

**Options:**

- **A. (Recommended)** One shipping aggregator instead of two carrier contracts. An account with EasyPost or Shippo gives you FedEx and UPS rates in a single call and prints both carriers' labels, which is exactly what "show the higher rate, ship on the cheaper one" needs, and it is one signup instead of two carrier approval processes. Add Stripe for cards and a Google Maps Platform key with a card on file for billing. You name one person this week who owns all three logins. I build everything behind a thin swap layer with a sandbox mode, so development does not wait on keys, and every integration has a manual fallback: if rates fail at 11pm the staffer types a shipping price and a tracking number by hand, and if Google routing fails the manager drags the stops into order herself.
- **B.** Go direct with your own FedEx and UPS accounts. Better rates if the organization already has negotiated pricing or an existing shipping relationship, but it is two separate approval processes, two sets of production credentials, and two integrations to keep alive — and if either one misses the cutoff, rate shopping only sees one carrier.
- **C.** Some or all of these already exist. Tell me which accounts are live today and who holds them, and I will build against what is real; anything not approved by the cutoff date runs manually this season with staff entering rates and routes by hand.
- **D.** Different — tell me how you want to handle it: ______

**Why it matters:** This is the only item on the whole list where "all of it, live this Purim" can fail for a reason no amount of building fixes. A merchant account application that stalls in underwriting, or a Google key with no billing card attached, will stop the storefront cold — and I would rather we start those applications this week and design the manual fallbacks deliberately than discover in the last fortnight that the checkout cannot take money. Naming a single account owner matters more than it sounds: on a small volunteer team, the credentials nobody owns are the credentials nobody can reset at 11pm.

**User:** A or B, whichever is better.

**I heard:** You deferred the carrier plumbing to me. This is an implementation choice rather than a product decision, so I will take it: **locking A — a shipping aggregator (EasyPost or Shippo), not direct FedEx and UPS contracts.**

Three reasons. First, "quote the higher rate and ship on the cheaper one" needs both carriers' rates in the same breath; an aggregator returns them in one call, where direct contracts mean two integrations, two authentication schemes and two sets of failure behaviour to handle in the checkout's hot path. Second, it is one signup instead of two enterprise approval processes, which matters when the deadline is a fixed date and the applications are the part I cannot speed up. Third — and this is why choosing A now costs you nothing later — both aggregators let you attach your own FedEx and UPS account numbers, so if the organization already has negotiated rates, or gets them next year, you plug those credentials in and keep your pricing while still calling one API. A gives you B's benefit without B's integration burden, so there is no strong reason to go direct.

Also locked in with it: Stripe for card payments, a Google Maps Platform key with billing attached, one named person in the organization owning all three logins, every integration behind a swap layer with a sandbox mode so the build does not wait on credentials, and a manual fallback on each — hand-entered shipping price and tracking number if rates fail, manual stop ordering if Google routing fails. Open item for you, not a question to answer now: tell me who that account owner is, and start the payment processor application first, since underwriting is the longest pole.

---

## Turn 7 — How a returning donor is recognised, and how they reach repeat-order

**Agent:**

Repeat-order and the per-customer address book are two of the headline features, and both depend on the system knowing who somebody is. But your donors are the same crowd as your staff — often older, often not fond of passwords — and a forgotten password in the ten days before Purim turns into a phone call to a volunteer who is already packing boxes. You also described repeat-order partly as an order-taker's tool, with a confirmation page where whoever is entering the order checks the replacement items. So I do not know whether a donor is meant to do this themselves on the website, or ring the house and have a staffer do it.

**Question:** How does a returning donor get recognised and reach their address book and last year's order?

**Options:**

- **A. (Recommended)** No passwords, ever. At checkout the donor gives an email address or mobile number; if we already know it, we text or email a one-time code and they are in. Signed in, they see their address book, their recipients and greeting cards from last year, and a "repeat last year's order" button that lands on the replacement-confirmation page before anything reaches the cart. Anyone can still check out as a guest without signing in at all — the system files them under their email so the address book is waiting next time. Staff have the identical capability from the POS, so a donor who would rather phone gets exactly the same flow with an order taker driving it. Nothing is self-serve only, and nothing is staff-only.
- **B.** Ordinary accounts with an email and a password on the storefront, like any other shop. Familiar to everyone and nothing to explain — at the cost of password resets landing on your team during the busiest fortnight of the year.
- **C.** No donor logins at all. The storefront is a plain checkout that anyone can use, and address books, recipient history and repeat-order live only in the back office. A returning donor phones the house and an order taker pulls up last year and walks them through the replacements. Smallest storefront to build and to teach; more phone calls, and no self-serve repeat orders at midnight.
- **D.** Different — tell me how you want returning donors handled: ______

**Why it matters:** This sets how much of the storefront I build and where your team's time goes during the season. It also decides something structural I would rather settle now than retrofit: whether a customer record exists independently of a login. If the answer is A or C, the person and their address book are the real records and any sign-in is just a way of proving you are them — which is what makes it possible for a staffer and a donor to be working on the same customer from two directions. If it is B, accounts and customers tend to fuse, and every guest order and every phone order becomes an orphan somebody has to merge by hand later.

**User:** B — Ordinary accounts with email and password on the storefront.

**I heard:** Donors sign in with an email address and a password, like any other shop. That is your call and I am building it, not relitigating it. I will make it as forgiving as I can inside that choice: self-serve reset by email, plus a staff-side "send this donor a reset link" button so an order taker can rescue somebody on the phone without touching a password, and a session that lasts long enough that a returning donor is not challenged every visit during the season.

One structural thing I am holding on to regardless: the customer record and the login stay separate underneath. A customer — with their address book, recipients, greeting cards and order history — exists whether or not anybody ever signs in, and the account is a credential attached to that customer, not the customer itself. Without that, every phone order and every imported record from your Excel files becomes an orphan somebody has to merge by hand, and staff could not open a customer the donor has not registered. This is plumbing, not a product decision, so I am taking it.

Open question for you, deferred so I do not spend a turn on it now: with passwords chosen, may somebody still check out as a guest without registering — and when a staffer takes a phone order for a brand-new donor, do we create a customer with no login, or send them an invite to set a password? Flag it if you have a strong view; otherwise I will bring it back later.

---

## Turn 8 — Getting a route into a volunteer driver's hands, and whether anything comes back

**Agent:**

You said routes can be sent to a driver volunteer and ordered by Google for the quickest path. "Sent" is doing a lot of work in that sentence. The person receiving it is a volunteer with their own car and their own phone, quite possibly driving for you for the first time in a year, on the busiest morning of the season — and the seed never says what, if anything, they send back to the house. That silence matters, because it is the difference between a delivery board that is live and one that is a guess until the driver returns.

**Question:** How should a route reach the volunteer driver, and what should the driver report back?

**Options:**

- **A. (Recommended)** No login for drivers. The manager builds the route, presses "send to driver," and the volunteer gets a text or email with a private link to a plain mobile page: the stops in Google's optimised order, each with the name, address, what is being dropped, and a big tap-to-open in Google Maps or Waze. One tap per stop marks it delivered, with a couple of preset notes for the real world — nobody home, left with a neighbour, wrong address. The house watches it tick over live. The link works only for that route and stops working after its date, so nothing lingers on an old phone. A printable route sheet is available for any driver who would rather have paper, and staff can mark stops for them from the office.
- **B.** Drivers get real accounts with a driver role, consistent with the storefront logins you just chose. Same mobile stop list, but they sign in to reach it. More control over who sees what and a permanent record of which volunteer did which route — at the cost of every volunteer needing credentials before they can drive, on the morning they show up.
- **C.** Paper only. The manager prints the optimised route sheet and the driver takes it in the car, exactly as a driver would today. Whoever is at the house keys in what came back when the driver returns. Nothing for a volunteer to learn, nothing to go wrong on a phone — and no live picture of where the deliveries stand until the car is back.
- **D.** Different — tell me how you want drivers handled: ______

**Why it matters:** Whether drivers report back decides whether "delivered" is a real, timestamped fact per recipient or a batch someone ticks off afterwards, and that is what a donor is ringing to ask about on Purim morning. It also sets how much I build: a driver-facing mobile surface is its own screen with its own offline-ish behaviour in a car with poor signal, whereas a printed sheet is a report. And requiring a login from a volunteer who is standing in your driveway with the engine running is exactly the kind of friction that ends with somebody driving off with a photo of a screen.

**User:** A, add a PIN or something, so random people can't hack in and mark deliveries done.

**I heard:** Driver hand-off is the no-login link, with a PIN on top so the link on its own is not enough. Concretely: the manager sends the route, the volunteer gets a text with the link, and the first thing the page asks for is a short code — sent in a separate message, or read out to the driver at the house, whichever suits the morning. Enter the code once and the phone stays trusted for that route so nobody is re-typing it at every stop. A forwarded or shoulder-surfed link is useless without the code, the code is per route rather than a shared password everyone learns, guessing is rate-limited and locked out after a handful of tries, and the whole thing dies when the route's date passes. The manager can revoke a route's link on the spot if a phone goes missing, and can see which stops were marked from the driver's device versus marked by staff in the office.

Everything else in A stands: stops in Google's optimised order, name, address and contents per stop, one tap to open Google Maps or Waze, one tap to mark delivered, preset real-world notes (nobody home, left with a neighbour, wrong address), a live board at the house, a printable route sheet for anyone who prefers paper, and office staff able to mark stops on a driver's behalf.

---

## Turn 9 — Who decides when each delivery option is available

**Agent:**

Your fulfillment types are not all available at the same time, and the seed only hints at it. Per-package delivery happens in the day or two before Purim. Bulk delivery can happen any time before Purim. Shipping has to stop early enough that a carrier can actually get a box there in time — order a shipment three days before Purim and it arrives to an empty table. The store also shuts down for the off season while still letting people browse old catalogs. So somewhere there is a calendar, and I need to know whether the system keeps it or a person does.

**Question:** How should the season's dates and cutoffs be decided and enforced?

**Options:**

- **A. (Recommended)** One season calendar screen, dates only, that a manager fills in each year: when the store opens, the shipping cutoff, the bulk delivery cutoff, the per-package delivery window, the pickup window, and the date the store closes for the off season. The storefront reads those dates and simply stops offering an option once its date has passed — the customer never sees a choice you cannot honour, and nobody has to remember to switch anything off at midnight. Staff in the back office see the same dates but can take an order outside a window with a warning, exactly as with the zip rules in Turn 4, because they know when a box can still make it. Closing day flips the store into browse-only with previous years' catalogs readable.
- **B.** No dates — plain switches. Each fulfillment option has an on/off toggle on a settings page, and a manager flips them when they decide the moment has come. Nothing happens automatically, nothing surprises anyone, and it lives or dies on somebody remembering at the right hour.
- **C.** Derive it. You enter one date — when Purim falls — and the system computes every cutoff from standard lead times built into each option (shipping closes N days before, per-package delivery opens two days before, and so on). One field a year, and the offsets are edited only if something changes.
- **D.** Different — tell me how you want the calendar handled: ______

**Why it matters:** These dates decide what a customer is allowed to buy on any given day, which makes them pricing and promise rules, not decoration — the wrong answer here is a donor paying for shipping on the Friday before Purim and a box arriving the following week. It also determines whether your team's busiest fortnight depends on somebody remembering to flip a switch at the right moment, and whether I build one dated rules engine that both the storefront and the POS read, or a settings page full of toggles that can quietly contradict each other.

**User:** A — One season calendar with dates; storefront hides expired options; staff override with warning; close → browse-only.

**I heard:** The season has a calendar and the system enforces it. A manager fills in the dates once a year — store opens, shipping cutoff, bulk delivery cutoff, per-package delivery window, pickup window, store closes — and from then on availability is automatic. The storefront simply stops offering an option once its window has passed, so a customer never gets to buy a promise you cannot keep and nobody has to remember to flip anything at midnight. Staff in the back office see the same calendar and may take an order outside a window, with a warning rather than a wall, which is now the third place this same pattern applies: zip eligibility, buildable stock, and dates all run through one rules engine with hard-stop on the storefront and warn-and-log for staff. When the closing date arrives the store flips itself into browse-only, with previous years' catalogs still readable.

Design consequences I am carrying forward: dates are per season and stored as data, not code, so next year is a form fill rather than a deploy; every date needs an explicit timezone and a definition of what "cutoff" means to the minute, since a cutoff at "the day before Purim" is meaningfully different at 9am and 11:59pm; and each staff override is logged with who and why, so an order that exists outside its window can be explained later.

---

## Turn 10 — What "it works" looks like before you bet the season on it

**Agent:**

This is my last question. Every decision so far has been about what to build; this one is about how we find out whether it actually holds up, and it is the one thing that cannot be added at the end. You have a fixed date, a small volunteer team, a workflow that currently runs on paper and works, and a system that has to take over all of it at once. Software that is fine in testing and fails at 9pm on the busiest night of the year is the specific outcome I want us to spend effort preventing.

**Question:** What is the proof, before the season opens, that this is safe to run the fundraiser on?

**Options:**

- **A. (Recommended)** A full dress rehearsal on real data, on a fixed date we set now — I would say three weeks before the store opens. We load last year's Excel export into a copy of the live system and replay a real day: your staff take a handful of orders on the storefront and a handful by phone, including one repeat order with replacement items, one multi-recipient order, and one order that gets switched between delivery types. Then the actual staffer runs a real print night on the real printer, with real label stock, and files the stack into the real folders — if the paper does not come out in the order she files in, that is a bug, not a preference. A manager builds a route and a volunteer drives three fake stops with the PIN link. One real box gets shipped to a real address and one card gets charged and refunded for a dollar. It is signed off by the people who will use it, not by me — and whatever fails, we fix and re-run before opening.
- **B.** Lighter and earlier: I demo each piece to you as it is finished, you click through it and approve, and we fix what you flag. Less of your team's time, no dress rehearsal, and the first real print night is the first real print night.
- **C.** Run both systems in parallel for the opening stretch — every order goes into the new system and also gets written down the old way, until you trust it. Doubles the work in the early weeks, but there is always a paper record and always a way back.
- **D.** Different — tell me what would make you confident: ______

**Why it matters:** Because "nothing gets deferred" means there is no season where the stakes are low, and the manual paper process you asked me to preserve is only a real fallback if somebody has actually tried falling back on it. A rehearsal on real data is also the only way we discover the things nobody thinks to specify — the label stock does not line up, the greeting card font is too small for the person filing them, last year's Excel has the recipient's apartment number in the wrong column. And picking the date now, rather than "when we're ready," is what makes it happen at all: dress rehearsals that are not on the calendar get skipped, and skipping this one moves the discovery of every one of those problems into the week you can least afford it.

**User:** A and B.

**I heard:** Both, which is the right answer and not a compromise. B is continuous: as each piece is finished I put it in front of you, you click through it, you tell me what is wrong, and it gets fixed while it is cheap to fix — that keeps the whole build from drifting away from what you pictured. A is the gate: one dress rehearsal on a fixed date, on a copy of the live system loaded with last year's real Excel data, run by the people who will actually run the season. Storefront orders and phone orders, a repeat order with replacement items, a multi-recipient order, an order switched between delivery types, a real print night on the real printer with real label stock filed into the real folders, a manager-built route driven with the PIN link, one real box shipped, one real card charged and refunded. Signed off by your staff, not by me, and re-run after fixes if it fails.

The important consequence: the rehearsal date gets set now and goes in the calendar alongside the season dates from Turn 9, roughly three weeks before the store opens, and it is a gate rather than a milestone — if the print night comes out in the wrong order, that blocks opening. Ongoing demos do not replace it, because the failures I am worried about are the ones that only appear when real data, real hardware and real people meet at once.

---

## Grill closed

Ten turns. The human answered every one; nothing below was invented by me. Where the human explicitly delegated a choice (Turn 6), I locked it and said so.

### Locked decisions

| # | Decision |
|---|---|
| **T1 — Scope** | Everything in the seed, one build, live for this coming Purim. Nothing deferred to next season, including map routing with Google optimisation and live carrier rate shopping. Fixed date, no scope relief. |
| **T2 — Prior-year data** | Last year's data exists and arrives as **Excel workbooks** (file drop, not a system API). One-time, re-runnable import of customers, address books, recipients, greeting card text, prior orders and prior catalog. Repeat-order and previous-year catalog browsing work on day one off that import; new items carry a "replaces item X" pointer into the imported catalog. |
| **T3 — Nightly print run** | Print-run screen defaults to the day's orders and does the filing for her: groups into her folder buckets (bulk delivery by area, per-package delivery, shipping, pickup, single-item), one PDF per bucket, each order's packing slip + labels + greeting cards adjacent and in sequence so the stack comes off the printer in filing order. **Printing is a pure log entry** — "printed on [date] by [staffer]" — and never marks packed/shipped/delivered. Reprints unrestricted, stamped as reprints. Print history is an event log, not a status. Bucket definitions are data, not hardcoded. |
| **T4 — Money on delivery-type switch** | Price is **locked at checkout** and immutable. Switching fulfillment type never auto-refunds or re-charges; savings from riding a shippable box along on a delivery route stay with the organisation as fundraising margin. Only a manager's explicit "adjust total" (reason required) moves money, via refund or payment link. Captured amount is stored separately from actual fulfillment cost so the spread is reportable. All adjustments are audited events with actor and reason. Zip eligibility is a storefront rule: **blocks customers, warns staff**. |
| **T5 — Inventory & production** | Two stock levels: components and finished packages, bridged by **optional** per-item recipes (no recipe = plain count). Production screen runs builds that consume components and produce finished packages. Buildable quantity is derived (finished stock + minimum buildable from components − committed to unfulfilled orders). Storefront **hard-stops** at zero with a sold-out state; staff POS **warns only**. Stock moves are ledger entries (received, consumed, produced, committed, fulfilled, adjusted-with-reason), not an overwritable count. |
| **T6 — Integrations** *(human deferred; I locked A)* | **Shipping aggregator (EasyPost or Shippo)** rather than direct FedEx/UPS contracts — both carriers' rates in one call, one approval process, and the organisation's own negotiated carrier accounts can be attached later, so it gives the direct-contract benefit without the integration burden. Plus **Stripe** for cards and **Google Maps Platform** with billing enabled. One named person owns all three logins. Everything behind a swap layer with sandbox mode so the build does not wait on credentials. **Manual fallback on every integration:** hand-entered shipping price and tracking number if rates fail; manually ordered stops if Google routing fails. |
| **T7 — Donor identity** | **Email + password accounts** on the storefront (human chose this over my passwordless recommendation). Mitigations inside that choice: self-serve email reset, a staff-side "send this donor a reset link" button so an order taker can rescue someone by phone without handling a password, and long sessions during the season. Structural: **the customer record and the login stay separate** — a customer with address book, recipients, greeting cards and history exists whether or not anyone signs in, so phone orders and Excel imports are never orphans. |
| **T8 — Driver hand-off** | No driver login. Manager sends the route; volunteer gets a link plus a **per-route PIN delivered separately**, entered once and then trusted on that device for that route. Rate-limited with lockout, manager can revoke on the spot, link dies when the route's date passes. Mobile stop list in Google's optimised order with name, address and contents, one tap to Maps/Waze, one tap to mark delivered, preset notes (nobody home, left with neighbour, wrong address). Live board at the house; printable route sheet as an alternative; office staff can mark stops on a driver's behalf, and the source of each mark is visible. |
| **T9 — Season calendar** | One per-season calendar screen of dates: store opens, shipping cutoff, bulk delivery cutoff, per-package delivery window, pickup window, store closes. Storefront availability follows the dates automatically — expired options simply are not offered. Staff may take orders outside a window with a **warning, logged with who and why**. Closing date flips the store to browse-only with previous years' catalogs readable. Dates are per-season data, so next year is a form fill, not a deploy. |
| **T10 — Validation** | **Both** continuous demos as pieces finish **and** a full dress rehearsal as a hard gate on a fixed date (~3 weeks before opening), on a copy of the live system loaded with last year's real Excel data: storefront + phone orders, a repeat order with replacements, a multi-recipient order, a delivery-type switch, a real print night on real label stock filed into real folders, a PIN-link route driven, one real box shipped, one real card charged and refunded. **Signed off by the staff who will use it**; failures block opening and the rehearsal re-runs. |

### Cross-cutting patterns established

- **One rules engine, two enforcement levels.** Zip eligibility (T4), buildable stock (T5) and season dates (T9) all resolve through the same engine: hard-stop on the storefront, warn-and-log for staff. Not two copies of the rules that drift apart.
- **Events, not overwrites.** Print history, stock movements, price adjustments, staff overrides and driver marks are all append-only records with an actor, a timestamp and — where a human made a judgement call — a reason.
- **Manual path preserved everywhere.** Printing never advances an order, every integration has a hand-entry fallback, routes can be paper, and staff can act on a driver's behalf. This is what makes the slow migration to automation real rather than aspirational.

### Open items — human input still needed

1. **The Excel workbooks themselves** — actual files, or header rows plus a few sample lines of each. Real exports are messier than they look (one row per order rather than per line item, addresses in a single blob, names spelled three ways) and the import and cleanup are shaped around the real columns.
2. **The Purim date and the season calendar values** — the deadline is "this Purim" but no date was given, and T9's calendar needs real dates: store open, each cutoff, the per-package window, and store close. Also the timezone and what "cutoff" means to the minute.
3. **Named account owner** for the aggregator, Stripe and Google Maps — and confirmation that the payment processor application is started first, since underwriting is the longest pole.
4. **EasyPost vs Shippo**, and whether the organisation already holds negotiated FedEx/UPS accounts worth attaching.
5. **Guest checkout residual (from T7)** — now that passwords are chosen, may someone still check out without registering, and when staff take a phone order for a brand-new donor, do we create a customer with no login or send an invite to set a password?
6. **The dress rehearsal date**, put on the calendar now rather than "when we're ready", plus which staff members sign it off.
7. **The exact folder scheme** the print buckets must match — her real folders, in her words.

### Not covered in this grill — flagged for the inventory, not answered here

Payment capture timing; how cash and check payments are recorded and reconciled; tax receipts or acknowledgement letters; back-office staff roles and permissions; greeting card format and length limits; duplicate recipient and address handling across customers; expected order volume and peak-day load; hosting and who administers it after the season.

**Status: closed. Ready for inventory-from-transcript.**
