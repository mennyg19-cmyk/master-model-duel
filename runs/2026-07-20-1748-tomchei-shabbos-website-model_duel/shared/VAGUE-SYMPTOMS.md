# Vague symptoms — Test 6 fix phase

No file paths or line numbers. Fix from symptoms only.

1. **Per-package delivery zone:** Customers whose addresses are *inside* the configured delivery ZIP list get turned away as "outside the delivery area" when they pick per-package delivery. Addresses that should be blocked sometimes go through.

2. **Shipping charge vs carrier rates:** The amount charged at checkout for shipped packages matches the *lowest* carrier quote instead of the higher displayed rate-shop price. Staff margin reports show little or no spread between charged and bought rates.

3. **Checkout API without browser origin:** Server-side or curl POSTs to the public checkout and quote endpoints succeed when sent with no `Origin` or `Referer` header. They should be rejected as cross-origin.

4. **Pay button dead end:** On the storefront checkout page, clicking pay/submit does not redirect to Stripe. The browser network tab shows a failed POST (404) instead of a payment session URL.

5. **Driver link skips PIN:** A delivery route magic link that was set up with a PIN can be used to view stops and call driver APIs without ever submitting the PIN — possession of the URL alone is enough.
