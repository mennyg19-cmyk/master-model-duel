import Link from 'next/link';

import { Card, CardDescription, CardTitle } from '@/components/ui/card';

/**
 * The needs-photos panel (R-128). Catalog and the media library both show it,
 * and the smoke run reads one `data-testid` for either page, so there is one
 * component behind both.
 */
export function NeedsPhotosCard({
  products,
  description,
}: {
  products: { id: string; name: string }[];
  description: string;
}) {
  if (products.length === 0) return null;

  return (
    <Card data-testid="needs-photos">
      <CardTitle>Needs photos ({products.length})</CardTitle>
      <CardDescription>{description}</CardDescription>
      <ul className="mt-3 space-y-1 text-sm">
        {products.map((product) => (
          <li key={product.id}>
            <Link
              href={`/admin/catalog/${product.id}`}
              className="underline underline-offset-4"
              data-testid="needs-photo-link"
            >
              {product.name}
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
