# Grill inventory — arm-01

| ID | Name | Transcript turns | Notes |
|---|---|---|---|
| G-001 | Hybrid fulfillment workflow | T1 | Preserve the paper-first workflow while offering optional `New`, `Printed`, `Packed`, and `Sent` or `Picked Up` stages for gradual adoption. |
| G-002 | Fulfillment document printing | T1 | Create packing slips, shipping labels, and greeting cards; printing must not automatically mark a package as shipped. |
| G-003 | Default package grouping | T2 | Group items by recipient, address, delivery method, and greeting into one package by default. |
| G-004 | Package splitting | T2 | Let staff split a default recipient grouping into multiple packages when needed. |
| G-005 | Package-level tracking and printing | T2 | Track statuses and print documents by package while retaining the link to the complete customer order. |
| G-006 | Staff fulfillment-method switching | T3 | Let staff switch paid packages between shipping and volunteer delivery as a backend cost-optimization action. |
| G-007 | Preserve paid delivery charge | T3 | A fulfillment-method switch must not refund, collect, or otherwise change the delivery charge already paid by the customer. |
| G-008 | Finished-package inventory | T4 | Make completed-package counts the primary production inventory flow at launch. |
| G-009 | Optional ingredient inventory | T4 | Support ingredient or supply tracking, but keep it hidden and optional at launch so users are not forced into it. `OPEN`: who enables it, and at what readiness point, is not specified. |
| G-010 | Bills of materials and assembly batches | T4 | Model each package's ingredient list and allow assembly batches to consume supplies and add finished packages to stock. |
| G-011 | Repeat-order draft creation | T5 | Copy a prior order into a draft for review rather than submitting it directly. |
| G-012 | Unmapped repeat-item resolution | T5 | Flag unavailable old items and require the order taker to choose a current item or remove the item before submission. |
| G-013 | Repeat-item replacement suggestions | T5 | Suggest price-matched current items when no explicit replacement mapping exists. |
| G-014 | Manual replacement mappings | T5 | Allow administrators to define explicit replacements from old catalog items to current items. |
| G-015 | Delivery-area ZIP gate | T6 | Hard-block per-package delivery outside the allowed ZIP list in both customer-facing and backend order entry; require shipping or pickup and provide no manager override. |
| G-016 | Bulk-delivery pricing | T7 | Charge one bulk-delivery fee per destination. |
| G-017 | Per-package delivery pricing | T7 | Charge a separate delivery fee for every recipient package. |
| G-018 | Staff and Manager roles | T8 | Default Staff permissions cover orders, cash/check payments, printing, and fulfillment; Manager permissions additionally cover prices, catalogs, delivery rules, inventory settings, and users. |
| G-019 | Per-person permission overrides | T8 | Let managers toggle specific permissions for an individual while retaining Staff and Manager as the default role model. |
| G-020 | Staff-scheduled bulk delivery | T9 | Customers choose bulk delivery without an appointment; staff group deliveries into routes and assign the date or time window. |
| G-021 | Bulk-delivery notification | T9 | Notify customers after staff schedule their bulk delivery. `OPEN`: the notification channel and delivery mechanism are not specified. |
| G-022 | Catalog-first cart order entry | T10 | Use a familiar ecommerce flow with catalog items, cart additions, quantities, and recipient assignment for both the public frontend and backend POS. |
| G-023 | Three-source recipient picker | T10 | When an item is added, assign it to a recipient already on the order, a recipient from the address book, or a new recipient. |
| G-024 | Address-book recipient persistence | T10 | Automatically save every newly entered recipient to the customer's address book. |
| G-025 | Per-recipient greeting memory | T11 | Pre-fill each recipient's latest greeting, allow it to be edited per gift, and save the final version for future and repeat orders. |
| G-026 | Off-season catalog archive | T12 | Provide a year-selectable archive of all prior catalogs, label items as not currently for sale, and disable cart and checkout. |
| G-027 | Nearby shipping-package map suggestions | T13 | Show managers unshipped shipping packages near a volunteer route. `OPEN`: the distance or other rule that qualifies a package as nearby is not specified. |
| G-028 | Confirmed map rerouting | T13 | On manager confirmation, switch the selected package to volunteer delivery and add it as a route stop; never reroute packages automatically. |
| G-029 | Fulfillment-method change audit | T13 | Log the manager-confirmed delivery-method change made from the map. |
| G-030 | Printed shipping-label invalidation | T1, T13 | Void an applicable printed-but-unshipped label when its package is rerouted. `OPEN`: the shipping-label vendor and voiding integration are not specified. |
