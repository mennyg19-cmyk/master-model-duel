import Link from 'next/link';
import type { CustomerAddress, FulfillmentMethod, PickupLocation } from '@prisma/client';

import { AddressFields } from '@/components/addresses/address-fields';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';
import { addressSummary } from '@/lib/addresses/address-summary';
import { formatCents } from '@/lib/core/money';
import type { CartLine } from '@/lib/orders/cart';

export type AssignmentOptions = {
  methods: FulfillmentMethod[];
  pickupLocations: PickupLocation[];
  addresses: CustomerAddress[];
  /** The account holder's own name, or null for a guest who has to type one. */
  selfName: string | null;
};

export type AssignmentLinks = {
  addRecipientHref: string;
  pickRecipientHref: string;
  editAddressHref: (addressId: string) => string;
  closeHref: string;
};

/**
 * The recipient picker (R-027). It is a panel at a URL, not a JavaScript modal:
 * `?assign=<line>` opens it, a refresh keeps it open, and it works with the
 * client bundle blocked — the same choice the storefront made for quick view.
 */
export function AssignmentPanel({
  line,
  options,
  links,
  assignAction,
}: {
  line: CartLine;
  options: AssignmentOptions;
  links: AssignmentLinks;
  assignAction: (formData: FormData) => Promise<void>;
}) {
  const hasBook = options.addresses.length > 0;

  return (
    <PanelShell
      title={`Who is “${line.name}” for?`}
      closeHref={links.closeHref}
      testId="assignment-panel"
      lineId={line.id}
    >
      <form action={assignAction} className="space-y-4">
        <input type="hidden" name="lineId" value={line.id} />

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Recipient</legend>

          <label className="flex items-start gap-2 text-sm">
            <input type="radio" name="target" value="self" defaultChecked className="mt-1" />
            <span>
              Keep it on my order
              {options.selfName ? ` — ${options.selfName}` : ''}
              <span className="block text-xs text-[var(--color-ink-muted)]">
                {hasBook
                  ? 'Pick it up, or send it to one of your own addresses.'
                  : 'Pick it up yourself. To have it delivered or shipped, add the address as a new recipient.'}
              </span>
            </span>
          </label>

          {/* A signed-in customer's own name comes from their account, so there is
              nothing to type. A guest has no account to read it from, and this is
              the field the server asks for. */}
          {options.selfName === null ? (
            <div className="ml-6">
              <Label htmlFor="self-recipientName">Your name</Label>
              <Input
                id="self-recipientName"
                name="recipientName"
                defaultValue={line.assignment?.recipientName ?? ''}
                autoComplete="name"
                maxLength={120}
                data-testid="self-recipient-name"
              />
            </div>
          ) : null}

          <label className="flex items-start gap-2 text-sm">
            <input
              type="radio"
              name="target"
              value="saved"
              className="mt-1"
              disabled={!hasBook}
              data-testid="assign-target-saved"
            />
            <span>
              Someone in my address book
              {hasBook ? '' : ' — nothing saved yet'}
            </span>
          </label>

          <p className="text-sm">
            <Link
              href={links.addRecipientHref}
              className="text-[var(--color-brand)] underline underline-offset-4"
              data-testid="add-recipient-link"
            >
              Add a new recipient
            </Link>
          </p>
        </fieldset>

        {hasBook ? (
          <div>
            <Label htmlFor="customerAddressId">Saved recipients</Label>
            <Select
              id="customerAddressId"
              name="customerAddressId"
              defaultValue={line.assignment?.customerAddressId ?? ''}
              data-testid="saved-address-select"
            >
              <option value="">Choose a saved recipient</option>
              {options.addresses.map((address) => (
                <option key={address.id} value={address.id}>
                  {address.recipientName} — {addressSummary(address)}
                </option>
              ))}
            </Select>

            <ul className="mt-2 space-y-1 text-xs">
              {options.addresses.map((address) => (
                <li key={address.id}>
                  <Link
                    href={links.editAddressHref(address.id)}
                    className="underline underline-offset-4"
                    data-testid="edit-saved-address-link"
                  >
                    Edit {address.recipientName}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <FulfillmentFields line={line} options={options} />

        <Button type="submit" data-testid="assign-submit">
          Save recipient
        </Button>
      </form>
    </PanelShell>
  );
}

/**
 * The add-recipient dialog (R-028). A new address is saved to the customer's
 * address book as it goes past, so the next box to the same person is two clicks
 * (UR-006).
 */
export function AddRecipientPanel({
  line,
  options,
  links,
  assignAction,
}: {
  line: CartLine;
  options: AssignmentOptions;
  links: AssignmentLinks;
  assignAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <PanelShell
      title={`Send “${line.name}” to someone new`}
      closeHref={links.closeHref}
      testId="add-recipient-panel"
      lineId={line.id}
    >
      <form action={assignAction} className="space-y-4">
        <input type="hidden" name="lineId" value={line.id} />
        <input type="hidden" name="target" value="new" />

        <AddressFields
          knownRecipients={options.addresses.map((address) => address.recipientName)}
          idPrefix="new-recipient"
        />

        <FulfillmentFields line={line} options={options} />

        <div className="flex items-center gap-3">
          <Button type="submit" data-testid="add-recipient-submit">
            Save recipient
          </Button>
          <Link href={links.pickRecipientHref} className="text-sm underline underline-offset-4">
            Back to saved recipients
          </Link>
        </div>
      </form>
    </PanelShell>
  );
}

/**
 * Editing a saved address without leaving the order (R-024, R-029). The change
 * follows every draft line that quotes the address, so a corrected street number
 * fixes the box that has not shipped yet rather than only the next one.
 */
export function SavedAddressEditor({
  address,
  line,
  saveAddressAction,
  cancelHref,
}: {
  address: CustomerAddress;
  line: CartLine;
  saveAddressAction: (formData: FormData) => Promise<void>;
  cancelHref: string;
}) {
  return (
    <PanelShell
      title={`Edit ${address.recipientName}`}
      closeHref={cancelHref}
      testId="edit-address-panel"
      lineId={line.id}
    >
      <form action={saveAddressAction} className="space-y-4">
        <input type="hidden" name="addressId" value={address.id} />
        <input type="hidden" name="lineId" value={line.id} />

        <AddressFields values={address} idPrefix="edit-address" />

        <Button type="submit" data-testid="edit-address-submit">
          Save address
        </Button>
      </form>
    </PanelShell>
  );
}

/** How it travels, and what the card says. Shared by both dialogs. */
function FulfillmentFields({
  line,
  options,
}: {
  line: CartLine;
  options: AssignmentOptions;
}) {
  return (
    <>
      <div>
        <Label htmlFor="fulfillmentMethodId">How should it get there?</Label>
        <Select
          id="fulfillmentMethodId"
          name="fulfillmentMethodId"
          defaultValue={options.methods[0]?.id}
          data-testid="method-select"
          required
        >
          {options.methods.map((method) => (
            <option key={method.id} value={method.id}>
              {method.label}
              {method.baseFeeCents > 0 ? ` (+${formatCents(method.baseFeeCents)})` : ''}
            </option>
          ))}
        </Select>
      </div>

      {options.pickupLocations.length > 0 ? (
        <div>
          <Label htmlFor="pickupLocationId">Pickup location (only for pickup)</Label>
          <Select id="pickupLocationId" name="pickupLocationId" defaultValue="">
            <option value="">Not picking up</option>
            {options.pickupLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      <div>
        <Label htmlFor="greetingMessage">Card message (optional)</Label>
        <textarea
          id="greetingMessage"
          name="greetingMessage"
          rows={2}
          maxLength={500}
          defaultValue={line.assignment?.greetingMessage ?? ''}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
        />
      </div>
    </>
  );
}

function PanelShell({
  title,
  closeHref,
  testId,
  lineId,
  children,
}: {
  title: string;
  closeHref: string;
  testId: string;
  lineId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-[var(--radius-card)] border border-[var(--color-brand)] bg-white p-5"
      data-testid={testId}
      data-line-id={lineId}
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <Link href={closeHref} className="text-sm text-[var(--color-ink-muted)]">
          Close
        </Link>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}
