'use server';

import { revalidatePath } from 'next/cache';

import { requirePermission } from '@/lib/auth/staff';
import { saveAddOn, saveProduct, setReplacementLink } from '@/lib/catalog/admin';

export type CatalogFormState = { error: string | null; notice: string | null };

export async function saveProductAction(
  _previous: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await requirePermission('catalog.manage');
  const productId = optionalText(formData, 'productId');

  const saved = await saveProduct(context, {
    productId,
    seasonId: String(formData.get('seasonId') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    description: String(formData.get('description') ?? ''),
    category: String(formData.get('category') ?? ''),
    kind: String(formData.get('kind') ?? 'PACKAGE'),
    price: String(formData.get('price') ?? ''),
    lengthMm: String(formData.get('lengthMm') ?? ''),
    widthMm: String(formData.get('widthMm') ?? ''),
    heightMm: String(formData.get('heightMm') ?? ''),
    weightGrams: String(formData.get('weightGrams') ?? ''),
    imageAssetId: String(formData.get('imageAssetId') ?? ''),
    tracksInventory: formData.get('tracksInventory') === 'on',
    isActive: formData.get('isActive') === 'on',
    sortOrder: Number(formData.get('sortOrder') ?? 0),
  });

  if (!saved.ok) return { error: saved.publicMessage, notice: null };

  revalidatePath('/admin/catalog');
  revalidatePath(`/admin/catalog/${saved.value.id}`);
  revalidatePath('/collection');

  return {
    error: null,
    notice: productId ? `Saved ${saved.value.name}.` : `Created ${saved.value.name}.`,
  };
}

export async function setReplacementAction(
  _previous: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await requirePermission('catalog.manage');
  const productId = String(formData.get('productId') ?? '');

  const linked = await setReplacementLink(context, {
    productId,
    replacedByProductId: optionalText(formData, 'replacedByProductId') ?? null,
  });

  if (!linked.ok) return { error: linked.publicMessage, notice: null };

  revalidatePath(`/admin/catalog/${productId}`);
  return {
    error: null,
    notice: linked.value.replacedByProductId ? 'Replacement saved.' : 'Replacement cleared.',
  };
}

export async function saveAddOnAction(
  _previous: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const context = await requirePermission('catalog.manage');
  const addOnId = optionalText(formData, 'addOnId');

  const saved = await saveAddOn(context, {
    addOnId,
    seasonId: String(formData.get('seasonId') ?? ''),
    slug: String(formData.get('slug') ?? ''),
    name: String(formData.get('name') ?? ''),
    price: String(formData.get('price') ?? ''),
    tracksInventory: formData.get('tracksInventory') === 'on',
    isActive: formData.get('isActive') === 'on',
    sortOrder: Number(formData.get('sortOrder') ?? 0),
    restrictedToProductIds: formData.getAll('restrictedToProductIds').map(String),
  });

  if (!saved.ok) return { error: saved.publicMessage, notice: null };

  revalidatePath('/admin/catalog/add-ons');
  return { error: null, notice: addOnId ? `Saved ${saved.value.name}.` : `Created ${saved.value.name}.` };
}

function optionalText(formData: FormData, field: string): string | undefined {
  const value = String(formData.get(field) ?? '').trim();
  return value === '' ? undefined : value;
}
