import {
  buyLabelAction,
  refreshTrackingAction,
  validateAddressAction,
  voidLabelAction,
} from '@/app/(admin)/admin/fulfillment/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/field';
import { formatCents } from '@/lib/core/money';
import { formatDateTime } from '@/lib/core/dates';
import { gramsToPounds } from '@/lib/core/units';
import type { CarriageCard as Carriage, CarriageParcel } from '@/lib/shipping/carriage-view';

/**
 * The carriage on one shipping box (UR-003, R-055, R-176, R-177).
 *
 * Buying is deliberately one button with no options: the margin engine already
 * decided which carrier the label goes on, and letting the packing table
 * second-guess it would break the relationship between what the customer was
 * charged and what the organization pays. The rates it chose between are shown
 * underneath so the decision can be read, not so it can be edited.
 */
const STATUS_TONE = {
  PENDING: 'warning',
  PURCHASED: 'success',
  FAILED: 'danger',
  VOID_PENDING: 'warning',
  VOIDED: 'neutral',
} as const;

const STATUS_LABEL = {
  PENDING: 'Buying',
  PURCHASED: 'Label bought',
  FAILED: 'Failed',
  VOID_PENDING: 'Cancelling',
  VOIDED: 'Cancelled',
} as const;

export function CarriageCard({ carriage }: { carriage: Carriage }) {
  const { quote } = carriage;

  return (
    <Card data-testid="carriage-card">
      <CardTitle>Carriage</CardTitle>
      <CardDescription>
        The carrier, the label and the tracking. The rate is bought on the cheapest carrier that can
        take the whole box; the customer was charged the highest.
      </CardDescription>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <form action={buyLabelAction}>
          <input type="hidden" name="packageId" value={carriage.packageId} />
          <Button type="submit" disabled={carriage.hasLiveLabel} data-testid="buy-label">
            Buy the label
          </Button>
        </form>

        <form action={refreshTrackingAction}>
          <input type="hidden" name="packageId" value={carriage.packageId} />
          <Button
            type="submit"
            variant="secondary"
            disabled={!carriage.hasLiveLabel}
            data-testid="refresh-tracking"
          >
            Refresh tracking
          </Button>
        </form>

        <form action={validateAddressAction}>
          <input type="hidden" name="packageId" value={carriage.packageId} />
          <Button type="submit" variant="secondary" data-testid="validate-address">
            Check the address
          </Button>
        </form>
      </div>

      {carriage.canVoid ? (
        <form action={voidLabelAction} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="packageId" value={carriage.packageId} />
          <Input
            name="reason"
            placeholder="Why is it being cancelled?"
            className="w-72"
            aria-label="Reason for cancelling the label"
            required
          />
          <Button type="submit" variant="secondary" data-testid="void-label">
            Cancel the label
          </Button>
        </form>
      ) : null}

      <AddressVerdict address={carriage.address} />

      {carriage.parcels.length === 0 ? (
        <p className="mt-4 text-sm text-[var(--color-ink-muted)]" data-testid="carriage-unlabelled">
          No label has been bought for this box yet.
        </p>
      ) : (
        <ul className="mt-4 space-y-3" data-testid="carriage-parcels">
          {carriage.parcels.map((parcel) => (
            <Parcel key={parcel.id} parcel={parcel} />
          ))}
        </ul>
      )}

      {quote ? (
        <div className="mt-4" data-testid="carriage-quote">
          <p className="text-sm font-medium">
            Rates {formatDateTime(quote.requestedAt)}
            {quote.source === 'FALLBACK' ? ' — no carrier answered, the flat rate was used' : ''}
          </p>
          <p className="text-xs text-[var(--color-ink-muted)]">
            {quote.parcelCount} parcel{quote.parcelCount === 1 ? '' : 's'} ·{' '}
            {weightLabel(quote.billableWeightGrams)} lb · charged{' '}
            {formatCents(quote.customerPriceCents)}
          </p>

          <ul className="mt-2 space-y-1 text-sm">
            {quote.options.map((option) => (
              <li
                key={`${option.carrier}-${option.serviceLabel}`}
                className="flex justify-between gap-4"
                data-testid="carriage-rate"
              >
                <span>
                  {option.carrier} {option.serviceLabel}
                  {option.isSelected ? ' — bought on this one' : ''}
                  {option.isEligible ? '' : ' — cannot take this box'}
                </span>
                <span className="text-[var(--color-ink-muted)]">
                  {formatCents(option.carrierCostCents)}
                  {option.transitDays === null ? '' : ` · ${option.transitDays} days`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}

function Parcel({ parcel }: { parcel: CarriageParcel }) {
  return (
    <li className="rounded-md bg-[var(--color-surface-muted)] p-3 text-sm" data-testid="carriage-parcel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          Parcel {parcel.parcelIndex + 1}
          {parcel.boxTypeName ? ` · ${parcel.boxTypeName}` : ''} · {weightLabel(parcel.weightGrams)}{' '}
          lb
        </span>
        <Badge tone={STATUS_TONE[parcel.status]}>{STATUS_LABEL[parcel.status]}</Badge>
      </div>

      {parcel.carrier ? (
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {parcel.carrier} {parcel.serviceLabel ?? ''}
          {parcel.trackingNumber ? ` · ${parcel.trackingNumber}` : ''}
        </p>
      ) : null}

      {parcel.marginCents === null ? null : (
        <p className="mt-1 text-[var(--color-ink-muted)]">
          {formatCents(parcel.carrierCostCents ?? 0)} paid ·{' '}
          {formatCents(parcel.customerPriceCents ?? 0)} charged · {formatCents(parcel.marginCents)} to
          the campaign
        </p>
      )}

      {parcel.trackingStatus ? (
        <p className="mt-1" data-testid="carriage-tracking">
          {parcel.trackingStatus}
          {parcel.trackingCheckedAt ? (
            <span className="text-[var(--color-ink-muted)]">
              {' '}
              (asked {formatDateTime(parcel.trackingCheckedAt)})
            </span>
          ) : null}
        </p>
      ) : null}

      {parcel.failureMessage ? (
        <p className="mt-1 text-[var(--color-danger)]" data-testid="carriage-failure">
          {parcel.failureMessage}
        </p>
      ) : null}

      {parcel.voidReason ? (
        <p className="mt-1 text-[var(--color-ink-muted)]">Cancelled: {parcel.voidReason}</p>
      ) : null}

      {parcel.labelUrl && parcel.status === 'PURCHASED' ? (
        <a
          href={parcel.labelUrl}
          className="mt-1 inline-block underline underline-offset-4"
          target="_blank"
          rel="noreferrer"
        >
          Open the label
        </a>
      ) : null}
    </li>
  );
}

/** One decimal: the packing table is reading a weight, not billing on it. */
function weightLabel(grams: number): string {
  return gramsToPounds(grams, 1);
}

function AddressVerdict({ address }: { address: Carriage['address'] }) {
  if (!address.checkedAt) {
    return (
      <p className="mt-3 text-sm text-[var(--color-ink-muted)]" data-testid="address-unchecked">
        The address has not been checked with the carrier.
      </p>
    );
  }

  return (
    <p className="mt-3 text-sm" data-testid="address-verdict" data-valid={String(address.isValid)}>
      <Badge tone={address.isValid ? 'success' : 'warning'}>
        {address.isValid ? 'Address recognised' : 'Address not matched'}
      </Badge>{' '}
      <span className="text-[var(--color-ink-muted)]">
        {address.note} (checked {formatDateTime(address.checkedAt)})
      </span>
    </p>
  );
}
