import { ReactNode } from "react";
import { Input } from "@/components/ui/input";

export interface AddressFieldValues {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
}

// The street/apt/city/state/ZIP block shared by every address dialog
// (add-recipient, edit saved address, account address book) — one markup, so
// validation and layout can't drift between the three. `line1Suggestions`
// slots the address-book autocomplete dropdown inside the street label.
export function AddressFields({
  values,
  onChange,
  line1Placeholder,
  line1Suggestions,
}: {
  values: AddressFieldValues;
  onChange: (field: keyof AddressFieldValues, value: string) => void;
  line1Placeholder?: string;
  line1Suggestions?: ReactNode;
}) {
  return (
    <>
      <label className="relative text-sm text-stone-700">
        Street address
        <Input
          value={values.line1}
          onChange={(event) => onChange("line1", event.target.value)}
          placeholder={line1Placeholder}
          className="mt-1"
          autoComplete="off"
          data-address-autocomplete
        />
        {line1Suggestions}
      </label>

      <label className="text-sm text-stone-700">
        Apt / suite (optional)
        <Input
          value={values.line2}
          onChange={(event) => onChange("line2", event.target.value)}
          className="mt-1"
        />
      </label>

      <div className="grid grid-cols-3 gap-3">
        <label className="col-span-2 text-sm text-stone-700">
          City
          <Input value={values.city} onChange={(event) => onChange("city", event.target.value)} className="mt-1" />
        </label>
        <label className="text-sm text-stone-700">
          State
          <Input
            value={values.region}
            onChange={(event) => onChange("region", event.target.value)}
            className="mt-1"
          />
        </label>
      </div>
      <label className="text-sm text-stone-700">
        ZIP
        <Input
          value={values.postalCode}
          onChange={(event) => onChange("postalCode", event.target.value)}
          className="mt-1 w-32"
          inputMode="numeric"
        />
      </label>
    </>
  );
}
