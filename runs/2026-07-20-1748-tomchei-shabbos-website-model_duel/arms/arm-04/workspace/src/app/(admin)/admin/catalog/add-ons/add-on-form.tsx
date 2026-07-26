'use client';

import { useActionState } from 'react';

import { saveAddOnAction, type CatalogFormState } from '../actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';

const INITIAL_STATE: CatalogFormState = { error: null, notice: null };

export type AddOnFormValues = {
  addOnId?: string;
  slug: string;
  name: string;
  priceDollars: string;
  tracksInventory: boolean;
  isActive: boolean;
  sortOrder: number;
  restrictedToProductIds: string[];
};

export const EMPTY_ADD_ON: AddOnFormValues = {
  slug: '',
  name: '',
  priceDollars: '',
  tracksInventory: true,
  isActive: true,
  sortOrder: 0,
  restrictedToProductIds: [],
};

export function AddOnForm({
  seasons,
  seasonId,
  products,
  values,
  submitLabel,
}: {
  seasons: { id: string; label: string }[];
  seasonId: string;
  products: { id: string; name: string }[];
  values: AddOnFormValues;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(saveAddOnAction, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" data-testid="add-on-form">
      {values.addOnId ? <input type="hidden" name="addOnId" value={values.addOnId} /> : null}

      <div>
        <Label htmlFor={`addon-season-${values.addOnId ?? 'new'}`}>Season</Label>
        <Select id={`addon-season-${values.addOnId ?? 'new'}`} name="seasonId" defaultValue={seasonId}>
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor={`addon-name-${values.addOnId ?? 'new'}`}>Name</Label>
        <Input
          id={`addon-name-${values.addOnId ?? 'new'}`}
          name="name"
          defaultValue={values.name}
          required
        />
      </div>

      <div>
        <Label htmlFor={`addon-slug-${values.addOnId ?? 'new'}`}>Web address</Label>
        <Input
          id={`addon-slug-${values.addOnId ?? 'new'}`}
          name="slug"
          defaultValue={values.slug}
          placeholder="extra-bottle-of-wine"
          required
        />
      </div>

      <div>
        <Label htmlFor={`addon-price-${values.addOnId ?? 'new'}`}>Price in dollars</Label>
        <Input
          id={`addon-price-${values.addOnId ?? 'new'}`}
          name="price"
          defaultValue={values.priceDollars}
          required
        />
      </div>

      <fieldset className="sm:col-span-2">
        <legend className="mb-1 text-sm font-medium">Offer it only with</legend>
        <p className="mb-2 text-sm text-[var(--color-ink-muted)]">
          Pick nothing and the add-on is offered with every product in the season.
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {products.map((product) => (
            <label key={product.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="restrictedToProductIds"
                value={product.id}
                defaultChecked={values.restrictedToProductIds.includes(product.id)}
              />
              {product.name}
            </label>
          ))}
        </div>
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="tracksInventory" defaultChecked={values.tracksInventory} />
        Track stock
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} />
        Offer it now
      </label>

      <input type="hidden" name="sortOrder" value={values.sortOrder} />

      <div className="sm:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Saving…' : submitLabel}
        </Button>
      </div>

      {state.error ? (
        <p role="alert" className="text-sm text-[var(--color-danger)] sm:col-span-2">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p className="text-sm text-[var(--color-success)] sm:col-span-2" data-testid="add-on-notice">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
