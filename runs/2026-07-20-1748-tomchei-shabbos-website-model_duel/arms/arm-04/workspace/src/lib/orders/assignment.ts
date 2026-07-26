import 'server-only';

import type { CustomerAddress, FulfillmentMethod, OrderLine } from '@prisma/client';
import { z } from 'zod';

import {
  DEFAULT_COUNTRY,
  addressSchema,
  findCustomerAddress,
  saveCustomerAddress,
  type AddressInput,
} from '../addresses/address-book';
import { failure, ok, type Result } from '../core/result';
import { db } from '../db';
import { checkDeliveryAreaNow, DELIVERY_AREA_MESSAGES } from '../delivery-area';
import { ownerFilter, type DraftOwner } from './draft-access';

export const ASSIGNMENT_TARGETS = ['self', 'saved', 'new'] as const;

/**
 * The three ways a cart line finds its recipient (UR-006, G-018):
 *
 * - `self` — keep it on the order: it is going to the person placing it;
 * - `saved` — somebody already in the address book;
 * - `new` — a new recipient, who is added to the book on the way through.
 */
export type AssignmentTarget = (typeof ASSIGNMENT_TARGETS)[number];

export const ASSIGNMENT_NOT_ALLOWED = 'assignment_not_allowed';
export const INVALID_ASSIGNMENT = 'invalid_assignment';

const MAX_GREETING_LENGTH = 500;

const greetingSchema = z
  .string()
  .trim()
  .max(MAX_GREETING_LENGTH, `A card message has to fit in ${MAX_GREETING_LENGTH} characters.`)
  .transform((value) => (value === '' ? null : value));

export type AssignLineInput = {
  lineId: string;
  target: string;
  fulfillmentMethodId: string;
  customerAddressId?: string | null;
  pickupLocationId?: string | null;
  greetingMessage?: string | null;
  /** Used for `self` when nobody is signed in, and as the name of a new recipient. */
  recipientName?: string | null;
  newAddress?: AddressInput | null;
};

export type Assignment = {
  lineId: string;
  recipientName: string;
  savedAddressId: string | null;
};

/**
 * Points one cart line at one destination.
 *
 * Everything a form sends is re-checked here: the line has to belong to this
 * cart, the fulfillment method has to be one that is still offered, a saved
 * address has to be in this customer's own book, and volunteer delivery still
 * only reaches the ZIP list (G-014). A new recipient is saved to the address
 * book in the same call, which is what makes "type it once" true.
 */
export async function assignCartLine(
  owner: DraftOwner,
  input: AssignLineInput,
): Promise<Result<Assignment>> {
  const line = await db.orderLine.findFirst({
    where: { id: input.lineId, order: { status: 'DRAFT', ...ownerFilter(owner) } },
  });
  if (!line) return failure(ASSIGNMENT_NOT_ALLOWED, 'That item is no longer in your order.');

  if (!isAssignmentTarget(input.target)) {
    return failure(INVALID_ASSIGNMENT, 'Choose who this item is going to.');
  }

  const method = await db.fulfillmentMethod.findFirst({
    where: { id: input.fulfillmentMethodId, isActive: true },
  });
  if (!method) return failure(INVALID_ASSIGNMENT, 'Choose how this item should reach its recipient.');

  const greeting = greetingSchema.safeParse(input.greetingMessage ?? '');
  if (!greeting.success) return failure(INVALID_ASSIGNMENT, greeting.error.issues[0].message);

  const destination = await resolveDestination(owner, input, input.target, method);
  if (!destination.ok) return destination;

  const { recipientName, address, savedAddressId, pickupLocationId } = destination.value;

  await db.orderLine.update({
    where: { id: line.id },
    data: {
      recipientName,
      fulfillmentMethodId: method.id,
      pickupLocationId,
      customerAddressId: savedAddressId,
      addressLine1: address?.line1 ?? null,
      addressLine2: address?.line2 ?? null,
      addressCity: address?.city ?? null,
      addressState: address?.state ?? null,
      addressPostalCode: address?.postalCode ?? null,
      addressCountry: address ? (address.country ?? DEFAULT_COUNTRY) : null,
      greetingMessage: greeting.data,
    },
  });

  return ok({ lineId: line.id, recipientName, savedAddressId });
}

/** Back to the cart-first state: the item stays, the destination is forgotten. */
export async function unassignCartLine(
  owner: DraftOwner,
  lineId: string,
): Promise<Result<OrderLine>> {
  const line = await db.orderLine.findFirst({
    where: { id: lineId, order: { status: 'DRAFT', ...ownerFilter(owner) } },
  });
  if (!line) return failure(ASSIGNMENT_NOT_ALLOWED, 'That item is no longer in your order.');

  return ok(
    await db.orderLine.update({
      where: { id: line.id },
      data: {
        recipientName: null,
        fulfillmentMethodId: null,
        pickupLocationId: null,
        customerAddressId: null,
        addressLine1: null,
        addressLine2: null,
        addressCity: null,
        addressState: null,
        addressPostalCode: null,
        addressCountry: null,
      },
    }),
  );
}

export function isAssignmentTarget(value: string): value is AssignmentTarget {
  return (ASSIGNMENT_TARGETS as readonly string[]).includes(value);
}

type ResolvedDestination = {
  recipientName: string;
  address: AddressFields | null;
  savedAddressId: string | null;
  pickupLocationId: string | null;
};

type AddressFields = {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country?: string | null;
};

async function resolveDestination(
  owner: DraftOwner,
  input: AssignLineInput,
  target: AssignmentTarget,
  method: FulfillmentMethod,
): Promise<Result<ResolvedDestination>> {
  const pickup = await resolvePickupLocation(method, input.pickupLocationId);
  if (!pickup.ok) return pickup;

  const recipient = await resolveRecipient(owner, input, target);
  if (!recipient.ok) return recipient;

  // A pickup has no street address by definition: the location is the address,
  // and the recipient is whoever walks in for it.
  if (!method.requiresAddress) {
    return ok({
      recipientName: recipient.value.name,
      address: null,
      savedAddressId: null,
      pickupLocationId: pickup.value,
    });
  }

  const { address } = recipient.value;
  if (!address) return failure(INVALID_ASSIGNMENT, 'Enter the address this is going to.');

  if (method.kind === 'DELIVERY') {
    const check = await checkDeliveryAreaNow(address.postalCode);
    if (!check.deliverable) return failure(INVALID_ASSIGNMENT, DELIVERY_AREA_MESSAGES[check.reason]);
  }

  return ok({
    recipientName: recipient.value.name,
    address,
    savedAddressId: recipient.value.savedAddressId,
    pickupLocationId: pickup.value,
  });
}

async function resolvePickupLocation(
  method: FulfillmentMethod,
  pickupLocationId: string | null | undefined,
): Promise<Result<string | null>> {
  if (!method.requiresPickupLocation) return ok(null);
  if (!pickupLocationId) return failure(INVALID_ASSIGNMENT, 'Choose where this will be picked up.');

  const location = await db.pickupLocation.findFirst({
    where: { id: pickupLocationId, isActive: true },
  });
  if (!location) return failure(INVALID_ASSIGNMENT, 'That pickup location is not open any more.');

  return ok(location.id);
}

type ResolvedRecipient = {
  name: string;
  address: AddressFields | null;
  savedAddressId: string | null;
};

/** One branch per picker choice, so what each one may and may not do is readable. */
async function resolveRecipient(
  owner: DraftOwner,
  input: AssignLineInput,
  target: AssignmentTarget,
): Promise<Result<ResolvedRecipient>> {
  if (target === 'saved') return fromAddressBook(owner, input.customerAddressId);
  if (target === 'self') return fromAccountHolder(owner, input);
  return fromNewRecipient(owner, input);
}

async function fromAddressBook(
  owner: DraftOwner,
  customerAddressId: string | null | undefined,
): Promise<Result<ResolvedRecipient>> {
  if (owner.kind !== 'customer') {
    return failure(ASSIGNMENT_NOT_ALLOWED, 'Sign in to use a saved address.');
  }
  if (!customerAddressId) return failure(INVALID_ASSIGNMENT, 'Pick a saved recipient, or add a new one.');

  const saved = await findCustomerAddress(owner.customerId, customerAddressId);
  if (!saved) return failure(ASSIGNMENT_NOT_ALLOWED, 'That address is not in your address book.');

  return ok({ name: saved.recipientName, address: fieldsOf(saved), savedAddressId: saved.id });
}

/**
 * "On the order" means the person placing it. A signed-in customer's own name
 * comes from their account rather than from the form, so the picker cannot be
 * used to write an arbitrary name onto somebody else's order; a guest has no
 * account to read, so they type it and guest checkout (P5) confirms it.
 */
async function fromAccountHolder(
  owner: DraftOwner,
  input: AssignLineInput,
): Promise<Result<ResolvedRecipient>> {
  let name = (input.recipientName ?? '').trim();

  if (owner.kind === 'customer') {
    const customer = await db.customer.findUnique({ where: { id: owner.customerId } });
    if (!customer) return failure(ASSIGNMENT_NOT_ALLOWED, 'Sign in again to keep building this order.');
    name = customer.fullName;
  }

  if (name === '') return failure(INVALID_ASSIGNMENT, 'Tell us your name so we know who to send it to.');

  if (input.customerAddressId) {
    const saved = await fromAddressBook(owner, input.customerAddressId);
    if (!saved.ok) return saved;
    return ok({ ...saved.value, name });
  }

  if (!hasStreetAddress(input.newAddress)) return ok({ name, address: null, savedAddressId: null });

  return storeAddress(owner, input.newAddress, name);
}

async function fromNewRecipient(
  owner: DraftOwner,
  input: AssignLineInput,
): Promise<Result<ResolvedRecipient>> {
  const name = (input.recipientName ?? input.newAddress?.recipientName ?? '').trim();
  if (name === '') return failure(INVALID_ASSIGNMENT, 'Who is this going to?');

  if (!hasStreetAddress(input.newAddress)) return ok({ name, address: null, savedAddressId: null });
  return storeAddress(owner, input.newAddress, name);
}

/**
 * A new recipient joins the customer's address book on the way past (UR-006), so
 * the second box to the same person is two clicks. A guest has no book to join:
 * the address is copied onto the line, and P5's guest checkout is where the
 * account that could keep it is created.
 */
async function storeAddress(
  owner: DraftOwner,
  newAddress: AddressInput,
  recipientName: string,
): Promise<Result<ResolvedRecipient>> {
  if (owner.kind !== 'customer') {
    const parsed = addressSchema.safeParse({ ...newAddress, recipientName });
    if (!parsed.success) return failure(INVALID_ASSIGNMENT, parsed.error.issues[0].message);
    return ok({ name: recipientName, address: fieldsOf(parsed.data), savedAddressId: null });
  }

  const saved = await saveCustomerAddress({
    ...newAddress,
    recipientName,
    customerId: owner.customerId,
  });
  if (!saved.ok) return saved;

  return ok({
    name: saved.value.address.recipientName,
    address: fieldsOf(saved.value.address),
    savedAddressId: saved.value.address.id,
  });
}

/** An empty street line means the form's address fieldset was left blank. */
function hasStreetAddress(
  address: AddressInput | null | undefined,
): address is AddressInput {
  return typeof address?.line1 === 'string' && address.line1.trim() !== '';
}

function fieldsOf(
  address: CustomerAddress | (AddressFields & { line2?: string | null }),
): AddressFields {
  return {
    line1: address.line1,
    line2: address.line2 ?? null,
    city: address.city,
    state: address.state,
    postalCode: address.postalCode,
    country: address.country ?? DEFAULT_COUNTRY,
  };
}
