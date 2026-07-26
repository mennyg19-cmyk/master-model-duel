import 'server-only';

import { z } from 'zod';

import { toCents } from '../core/money';
import { gramsToPounds } from '../core/units';
import { env } from '../env';
import { CarrierRequestError } from './provider';
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
 * Shippo over `fetch`, the same way Stripe is done here: five REST calls do not
 * justify an SDK, and the SDK's own model of a shipment is not the one this
 * application has.
 *
 * Shippo speaks inches, pounds and decimal strings; this file is the only place
 * that does. Everything it returns is millimetres, grams and integer cents.
 */
const SHIPPO_API = 'https://api.goshippo.com';
const REQUEST_TIMEOUT_MS = 20_000;

const MM_PER_INCH = 25.4;

/** Shippo takes dimensions and weights as strings; two decimals is finer than any carrier measures. */
const CARRIER_DECIMALS = 2;

const rateSchema = z.object({
  object_id: z.string(),
  amount: z.string(),
  provider: z.string(),
  estimated_days: z.number().int().nullable().optional(),
  servicelevel: z.object({ name: z.string().optional(), token: z.string().optional() }).optional(),
});

const shipmentSchema = z.object({ rates: z.array(rateSchema).default([]) });

const transactionSchema = z.object({
  object_id: z.string(),
  status: z.string(),
  tracking_number: z.string().nullable().optional(),
  label_url: z.string().nullable().optional(),
  messages: z.array(z.object({ text: z.string().optional() })).optional(),
});

const refundSchema = z.object({ status: z.string() });

const trackSchema = z.object({
  tracking_status: z
    .object({ status: z.string().optional(), status_details: z.string().nullable().optional() })
    .nullable()
    .optional(),
});

const addressSchema = z.object({
  is_complete: z.boolean().optional(),
  validation_results: z
    .object({
      is_valid: z.boolean().optional(),
      messages: z.array(z.object({ text: z.string().optional() })).optional(),
    })
    .optional(),
});

export function createShippoProvider(): ShippingProvider {
  const token = env.SHIPPO_API_TOKEN;

  // The env schema already refuses this combination. The check is here so the
  // failure is a sentence rather than a 401 from an "Authorization: ShippoToken
  // undefined" header.
  if (!token) {
    throw new Error('SHIPPING_PROVIDER=shippo needs SHIPPO_API_TOKEN, which is empty.');
  }

  return {
    name: 'shippo',

    async quote(request: RateRequest): Promise<CarrierRate[]> {
      const shipment = shipmentSchema.parse(
        await call(token, 'POST', '/shipments/', {
          address_from: toShippoAddress(request.from),
          address_to: toShippoAddress(request.to),
          parcels: [
            {
              length: inches(request.parcel.lengthMm),
              width: inches(request.parcel.widthMm),
              height: inches(request.parcel.heightMm),
              distance_unit: 'in',
              weight: gramsToPounds(request.parcel.weightGrams, CARRIER_DECIMALS),
              mass_unit: 'lb',
            },
          ],
          ...(request.carrierAccounts.length > 0
            ? { carrier_accounts: request.carrierAccounts.map((account) => account.accountId) }
            : {}),
          async: false,
        }),
      );

      return shipment.rates.map((rate) => ({
        rateId: rate.object_id,
        carrier: rate.provider,
        serviceCode: rate.servicelevel?.token ?? 'default',
        serviceLabel: rate.servicelevel?.name ?? rate.provider,
        amountCents: toCents(Number(rate.amount)),
        transitDays: rate.estimated_days ?? null,
      }));
    },

    async buyLabel(rateId: string): Promise<PurchasedLabel> {
      const transaction = transactionSchema.parse(
        await call(token, 'POST', '/transactions', {
          rate: rateId,
          label_file_type: 'PDF',
          async: false,
        }),
      );

      if (transaction.status !== 'SUCCESS' || !transaction.tracking_number || !transaction.label_url) {
        const said = (transaction.messages ?? [])
          .map((message) => message.text)
          .filter(Boolean)
          .join('; ');

        throw new Error(
          `Shippo would not issue a label for rate ${rateId}: status ${transaction.status}${said ? ` — ${said}` : ''}`,
        );
      }

      return {
        transactionId: transaction.object_id,
        trackingNumber: transaction.tracking_number,
        labelUrl: transaction.label_url,
      };
    },

    async voidLabel(transactionId: string): Promise<VoidOutcome> {
      const refund = refundSchema.parse(
        await call(token, 'POST', '/refunds/', { transaction: transactionId, async: false }),
      );

      if (refund.status === 'ERROR') {
        throw new Error(
          `Shippo refused to cancel label ${transactionId}: it reports the label as used. ` +
            'A used label cannot be refunded.',
        );
      }

      // QUEUED and PENDING are the normal answers: carriers confirm a refund
      // days later. The label is dead to us either way — it may not be handed
      // over once cancelled — so the box is free to be labelled again.
      return {
        confirmed: refund.status === 'SUCCESS',
        note:
          refund.status === 'SUCCESS'
            ? 'The carrier confirmed the refund.'
            : `The carrier is still processing the refund (${refund.status.toLowerCase()}).`,
      };
    },

    async track(carrier: string, trackingNumber: string): Promise<TrackingUpdate> {
      const track = trackSchema.parse(
        await call(
          token,
          'GET',
          `/tracks/${encodeURIComponent(carrier.toLowerCase())}/${encodeURIComponent(trackingNumber)}`,
        ),
      );

      return {
        status: track.tracking_status?.status ?? 'UNKNOWN',
        note: track.tracking_status?.status_details ?? null,
      };
    },

    async validateAddress(address: ShippingAddress): Promise<AddressVerdict> {
      const validated = addressSchema.parse(
        await call(token, 'POST', '/addresses/', { ...toShippoAddress(address), validate: true }),
      );

      const said = (validated.validation_results?.messages ?? [])
        .map((message) => message.text)
        .filter(Boolean)
        .join('; ');

      const isValid = validated.validation_results?.is_valid === true;

      return {
        isValid,
        note: said || (isValid ? 'The carrier recognises this address.' : 'The carrier could not match this address.'),
      };
    },
  };
}

function toShippoAddress(address: ShippingAddress) {
  return {
    name: address.name,
    street1: address.line1,
    street2: address.line2 ?? '',
    city: address.city,
    state: address.state,
    zip: address.postalCode,
    country: address.country,
    phone: address.phone ?? '',
  };
}

function inches(millimetres: number): string {
  return (millimetres / MM_PER_INCH).toFixed(CARRIER_DECIMALS);
}

async function call(
  token: string,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<unknown> {
  const response = await fetch(`${SHIPPO_API}${path}`, {
    method,
    headers: {
      authorization: `ShippoToken ${token}`,
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const payload: unknown = await response.json();
  if (!response.ok) throw new CarrierRequestError(response.status, `Shippo ${method} ${path}`);

  return payload;
}
