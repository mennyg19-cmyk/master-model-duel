import 'server-only';

import { randomBytes } from 'node:crypto';

import type {
  AddressVerdict,
  CarrierRate,
  PurchasedLabel,
  RateRequest,
  ShippingAddress,
  ShippingProvider,
  TrackingUpdate,
  VoidOutcome,
} from './provider';

/**
 * The offline stand-in for a carrier account.
 *
 * Everything above it — rate shopping, the margin engine, the two-step label
 * claim, voiding, tracking, address validation — runs exactly as it does
 * against Shippo. Only the carriers are imaginary, and the env schema refuses
 * this provider unless the app answers on loopback, so nobody can be sold a
 * label that does not exist.
 *
 * Prices are a function of the destination and the weight rather than random,
 * for two reasons: a rate that changes on every page load cannot be checked
 * against what was charged, and the cheapest carrier has to differ by
 * destination or the margin engine would never be exercised.
 */
const RATE_PREFIX = 'local-rate';
const BASE_CENTS = 695;
const CENTS_PER_500_GRAMS = 45;
const ZONE_STEP_CENTS = 200;

const CARRIERS = [
  { carrier: 'USPS', serviceCode: 'usps_priority', serviceLabel: 'USPS Priority Mail', transitDays: 3 },
  { carrier: 'FedEx', serviceCode: 'fedex_ground', serviceLabel: 'FedEx Home Delivery', transitDays: 4 },
  { carrier: 'UPS', serviceCode: 'ups_ground', serviceLabel: 'UPS Ground', transitDays: 4 },
] as const;

export function createLocalShippingProvider(): ShippingProvider {
  return {
    name: 'local',

    async quote(request: RateRequest): Promise<CarrierRate[]> {
      // USPS is always there — it is the provider's own default account — and
      // FedEx and UPS appear only when the org has configured that slot, which
      // is the behaviour the real accounts have.
      const offered = new Set<string>(['USPS', ...request.carrierAccounts.map((account) => account.carrier)]);

      return CARRIERS.filter((carrier) => offered.has(carrier.carrier)).map((carrier, index) => {
        const amountCents = priceOf(request, index);

        return {
          rateId: [RATE_PREFIX, carrier.carrier, carrier.serviceCode, amountCents].join(':'),
          carrier: carrier.carrier,
          serviceCode: carrier.serviceCode,
          serviceLabel: carrier.serviceLabel,
          amountCents,
          transitDays: carrier.transitDays,
        };
      });
    },

    async buyLabel(rateId: string): Promise<PurchasedLabel> {
      const [prefix, carrier] = rateId.split(':');
      if (prefix !== RATE_PREFIX) {
        throw new Error(`${rateId} is not a rate this stand-in issued, so no label can be bought against it.`);
      }

      const serial = randomBytes(6).toString('hex').toUpperCase();

      return {
        transactionId: `local-txn-${randomBytes(8).toString('hex')}`,
        trackingNumber: `${carrier.toUpperCase()}${serial}`,
        // Deliberately not a URL this application serves: a stand-in label is
        // not a document, and a page that pretends otherwise would get printed.
        labelUrl: `https://labels.invalid/local/${serial}.pdf`,
      };
    },

    async voidLabel(): Promise<VoidOutcome> {
      return { confirmed: true, note: 'The stand-in cancelled the label immediately.' };
    },

    async track(carrier: string, trackingNumber: string): Promise<TrackingUpdate> {
      return {
        status: 'TRANSIT',
        note: `${carrier} last scanned ${trackingNumber} at a sorting facility.`,
      };
    },

    async validateAddress(address: ShippingAddress): Promise<AddressVerdict> {
      const hasZip = /^\d{5}(-\d{4})?$/.test(address.postalCode.trim());
      const hasStreetNumber = /\d/.test(address.line1);

      if (hasZip && hasStreetNumber) {
        return { isValid: true, note: 'The address matches a deliverable street address.' };
      }

      return {
        isValid: false,
        note: hasZip
          ? 'The street line has no building number, so the carrier cannot match it.'
          : `${address.postalCode || 'The ZIP code'} is not a five-digit US ZIP code.`,
      };
    },
  };
}

/**
 * Weight and distance, plus a per-carrier step that rotates with the
 * destination, so which carrier is cheapest depends on where the box is going —
 * the situation the margin engine exists for.
 */
function priceOf(request: RateRequest, carrierIndex: number): number {
  const zipSum = [...request.to.postalCode].reduce(
    (total, character) => total + (Number.isNaN(Number(character)) ? 0 : Number(character)),
    0,
  );

  const weightCents = Math.ceil(request.parcel.weightGrams / 500) * CENTS_PER_500_GRAMS;
  const zoneCents = ((zipSum + carrierIndex * 2) % 3) * ZONE_STEP_CENTS;

  // The carrier index also adds a few cents so two carriers never tie, which
  // would make "the cheapest" a coin toss the tests could not pin down.
  return BASE_CENTS + weightCents + zoneCents + carrierIndex * 7;
}
