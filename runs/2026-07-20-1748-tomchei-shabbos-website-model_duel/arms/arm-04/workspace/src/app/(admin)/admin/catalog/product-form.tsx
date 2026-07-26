'use client';

import { useActionState } from 'react';

import { saveProductAction, type CatalogFormState } from './actions';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/field';

const INITIAL_STATE: CatalogFormState = { error: null, notice: null };

export type ProductFormValues = {
  productId?: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  kind: string;
  priceDollars: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  weightGrams: string;
  imageAssetId: string;
  tracksInventory: boolean;
  isActive: boolean;
  sortOrder: number;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  slug: '',
  name: '',
  description: '',
  category: '',
  kind: 'PACKAGE',
  priceDollars: '',
  lengthMm: '',
  widthMm: '',
  heightMm: '',
  weightGrams: '',
  imageAssetId: '',
  tracksInventory: true,
  isActive: true,
  sortOrder: 0,
};

/** One form for creating and editing, because the two differ only by which season is fixed. */
export function ProductForm({
  seasons,
  seasonId,
  images,
  values,
  submitLabel,
}: {
  seasons: { id: string; label: string }[];
  seasonId: string;
  images: { id: string; label: string }[];
  values: ProductFormValues;
  submitLabel: string;
}) {
  const [state, formAction, isPending] = useActionState(saveProductAction, INITIAL_STATE);

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2" data-testid="product-form">
      {values.productId ? <input type="hidden" name="productId" value={values.productId} /> : null}

      <div>
        <Label htmlFor="product-season">Season</Label>
        {values.productId ? (
          // A product cannot change season — `saveProduct` keeps the one it was
          // created in — so the editor states it instead of offering a move.
          <p id="product-season" className="py-2 text-sm">
            {seasons.find((season) => season.id === seasonId)?.label ?? 'Unknown season'}
          </p>
        ) : (
          <Select id="product-season" name="seasonId" defaultValue={seasonId}>
            {seasons.map((season) => (
              <option key={season.id} value={season.id}>
                {season.label}
              </option>
            ))}
          </Select>
        )}
      </div>

      <div>
        <Label htmlFor="product-name">Name</Label>
        <Input id="product-name" name="name" defaultValue={values.name} required />
      </div>

      <div>
        <Label htmlFor="product-slug">Web address</Label>
        <Input
          id="product-slug"
          name="slug"
          defaultValue={values.slug}
          placeholder="classic-mishloach-manos"
          required
        />
      </div>

      <div>
        <Label htmlFor="product-category">Category</Label>
        <Input
          id="product-category"
          name="category"
          defaultValue={values.category}
          placeholder="Boxes"
        />
      </div>

      <div>
        <Label htmlFor="product-price">Price in dollars</Label>
        <Input id="product-price" name="price" defaultValue={values.priceDollars} required />
      </div>

      <div>
        <Label htmlFor="product-kind">Kind</Label>
        <Select id="product-kind" name="kind" defaultValue={values.kind}>
          <option value="PACKAGE">Package</option>
          <option value="BUNDLE">Bundle</option>
          <option value="SPONSORSHIP">Sponsorship</option>
        </Select>
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="product-description">Description</Label>
        <textarea
          id="product-description"
          name="description"
          defaultValue={values.description}
          rows={3}
          className="w-full rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
        />
      </div>

      <div>
        <Label htmlFor="product-image">Photo</Label>
        <Select id="product-image" name="imageAssetId" defaultValue={values.imageAssetId}>
          <option value="">No photo yet</option>
          {images.map((image) => (
            <option key={image.id} value={image.id}>
              {image.label}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="product-sort">Sort order</Label>
        <Input id="product-sort" name="sortOrder" type="number" min={0} defaultValue={values.sortOrder} />
      </div>

      <fieldset className="grid gap-3 sm:col-span-2 sm:grid-cols-4">
        <legend className="mb-1 text-sm font-medium">Shipping size</legend>
        {(
          [
            ['lengthMm', 'Length (mm)'],
            ['widthMm', 'Width (mm)'],
            ['heightMm', 'Height (mm)'],
            ['weightGrams', 'Weight (g)'],
          ] as const
        ).map(([field, label]) => (
          <div key={field}>
            <Label htmlFor={`product-${field}`}>{label}</Label>
            <Input id={`product-${field}`} name={field} defaultValue={values[field]} />
          </div>
        ))}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="tracksInventory" defaultChecked={values.tracksInventory} />
        Track stock for this product
      </label>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={values.isActive} />
        Show it in the current collection
      </label>

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
        <p className="text-sm text-[var(--color-success)] sm:col-span-2" data-testid="catalog-notice">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
