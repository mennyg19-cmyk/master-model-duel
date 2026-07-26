import { Input, Label } from '@/components/ui/field';
import { formatPhone } from '@/lib/core/phone';

export type AddressFieldValues = {
  label?: string | null;
  recipientName?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  phone?: string | null;
};

/**
 * The one address form in the app. The builder's add-recipient dialog, the
 * account address page and the staff screen all render this, so a field that is
 * required in one place cannot be optional in another — and the field names are
 * what every address action reads.
 *
 * Autocomplete comes from two directions: the browser's own address autofill
 * through the `autoComplete` attributes, and the customer's saved recipients
 * through a `<datalist>`. Neither needs a paid lookup service, and the server
 * still validates and normalizes whatever arrives (R-025).
 */
export function AddressFields({
  values,
  knownRecipients = [],
  idPrefix = 'address',
}: {
  values?: AddressFieldValues;
  knownRecipients?: string[];
  idPrefix?: string;
}) {
  const listId = `${idPrefix}-recipients`;

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-recipientName`}>Recipient name</Label>
        <Input
          id={`${idPrefix}-recipientName`}
          name="recipientName"
          defaultValue={values?.recipientName ?? ''}
          list={knownRecipients.length > 0 ? listId : undefined}
          autoComplete="name"
          maxLength={120}
          required
        />
        {knownRecipients.length > 0 ? (
          <datalist id={listId} data-testid="recipient-autocomplete">
            {knownRecipients.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        ) : null}
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-line1`}>Street address</Label>
        <Input
          id={`${idPrefix}-line1`}
          name="line1"
          defaultValue={values?.line1 ?? ''}
          autoComplete="address-line1"
          maxLength={160}
          required
        />
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor={`${idPrefix}-line2`}>Apartment or unit (optional)</Label>
        <Input
          id={`${idPrefix}-line2`}
          name="line2"
          defaultValue={values?.line2 ?? ''}
          autoComplete="address-line2"
          maxLength={160}
        />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-city`}>City</Label>
        <Input
          id={`${idPrefix}-city`}
          name="city"
          defaultValue={values?.city ?? ''}
          autoComplete="address-level2"
          maxLength={80}
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor={`${idPrefix}-state`}>State</Label>
          <Input
            id={`${idPrefix}-state`}
            name="state"
            defaultValue={values?.state ?? ''}
            autoComplete="address-level1"
            maxLength={2}
            required
          />
        </div>
        <div>
          <Label htmlFor={`${idPrefix}-postalCode`}>ZIP</Label>
          <Input
            id={`${idPrefix}-postalCode`}
            name="postalCode"
            defaultValue={values?.postalCode ?? ''}
            autoComplete="postal-code"
            inputMode="numeric"
            maxLength={10}
            required
          />
        </div>
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-phone`}>Phone (optional)</Label>
        <Input
          id={`${idPrefix}-phone`}
          name="phone"
          defaultValue={values?.phone ? formatPhone(values.phone) : ''}
          autoComplete="tel"
          maxLength={20}
        />
      </div>

      <div>
        <Label htmlFor={`${idPrefix}-label`}>Nickname for your address book (optional)</Label>
        <Input
          id={`${idPrefix}-label`}
          name="label"
          defaultValue={values?.label ?? ''}
          maxLength={60}
        />
      </div>
    </div>
  );
}
