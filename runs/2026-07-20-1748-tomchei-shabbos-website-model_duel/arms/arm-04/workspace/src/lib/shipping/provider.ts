import 'server-only';

import { env } from '../env';
import { createLocalShippingProvider } from './local-provider';
import { createShippoProvider } from './shippo-api';

/**
 * One way to buy carriage, whoever is behind it (R-173).
 *
 * Five verbs, because those are the five things the office does: ask what a box
 * would cost, buy the label, cancel it, ask where it is, and check the address
 * before any of that. Everything above this file works in cents and millimetres
 * and never sees a carrier's own vocabulary.
 */
export type ShippingAddress = {
  name: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  phone: string | null;
};

export type ParcelSpec = {
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  weightGrams: number;
};

/**
 * A carrier the org holds an account with. The carrier's name travels with the
 * id because the id alone says nothing about who it is with, and the rate
 * comparison has to be able to name the carrier it picked.
 */
export type CarrierAccount = { carrier: 'FedEx' | 'UPS'; accountId: string };

export type RateRequest = {
  from: ShippingAddress;
  to: ShippingAddress;
  parcel: ParcelSpec;
  /**
   * The org's own carrier accounts. An empty list means "whatever the provider
   * account offers by default", which for Shippo is its USPS account.
   */
  carrierAccounts: CarrierAccount[];
};

export type CarrierRate = {
  /** What a label is bought against. */
  rateId: string;
  carrier: string;
  serviceCode: string;
  serviceLabel: string;
  amountCents: number;
  transitDays: number | null;
};

export type PurchasedLabel = {
  transactionId: string;
  trackingNumber: string;
  labelUrl: string;
};

export type VoidOutcome = { confirmed: boolean; note: string };

export type TrackingUpdate = { status: string; note: string | null };

export type AddressVerdict = { isValid: boolean; note: string };

/**
 * A carrier refusing an HTTP request.
 *
 * The status is kept and the response body is deliberately not: a carrier
 * answers a bad shipment by quoting the shipment back, recipient address
 * included, and this error's message ends up in the server log.
 */
export class CarrierRequestError extends Error {
  constructor(
    readonly status: number,
    request: string,
  ) {
    super(`${request} returned ${status}`);
    this.name = 'CarrierRequestError';
  }
}

export type ShippingProvider = {
  readonly name: 'shippo' | 'local';
  quote(request: RateRequest): Promise<CarrierRate[]>;
  buyLabel(rateId: string): Promise<PurchasedLabel>;
  voidLabel(transactionId: string): Promise<VoidOutcome>;
  track(carrier: string, trackingNumber: string): Promise<TrackingUpdate>;
  validateAddress(address: ShippingAddress): Promise<AddressVerdict>;
};

let provider: ShippingProvider | null = null;

/**
 * Built on first use and kept, for the same reason the payment gateway is: a
 * page that merely imports something from this folder must not have to be
 * configured for shipping.
 */
export function getShippingProvider(): ShippingProvider {
  provider ??= env.SHIPPING_PROVIDER === 'shippo' ? createShippoProvider() : createLocalShippingProvider();
  return provider;
}

/**
 * The carrier accounts the org has configured (R-183, R-184). An empty slot is
 * not an error: it means that carrier is not offered and can never win the rate
 * comparison, which is how a season with no UPS contract is expressed.
 */
export function carrierAccounts(): CarrierAccount[] {
  return [
    { carrier: 'FedEx', accountId: env.SHIPPO_FEDEX_ACCOUNT_ID ?? '' },
    { carrier: 'UPS', accountId: env.SHIPPO_UPS_ACCOUNT_ID ?? '' },
  ].filter((account): account is CarrierAccount => account.accountId !== '');
}
