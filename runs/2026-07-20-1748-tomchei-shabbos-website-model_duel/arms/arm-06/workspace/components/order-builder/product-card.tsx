"use client";

import { cn } from "@/lib/cn";
import { priceLabel } from "@/lib/storefront/pricing";
import { ProductImage } from "@/components/product-image";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { BuilderProduct } from "./types";

// R-026: builder product card — compact catalog tile with live stock and an
// add-to-cart entry point (quick view for options/add-ons).
export function ProductCard({
  product,
  onQuickView,
}: {
  product: BuilderProduct;
  onQuickView: (product: BuilderProduct) => void;
}) {

  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-lg border border-stone-200 bg-white shadow-sm",
        product.soldOut && "opacity-75",
      )}
      data-builder-product={product.slug}
    >
      <div className="relative flex h-32 items-center justify-center bg-brand-50 text-brand-200">
        <ProductImage src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" glyphSize={44} />
        {product.soldOut && (
          <Badge tone="red" className="absolute left-3 top-3">
            Sold out
          </Badge>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-3">
        {product.category && (
          <span className="text-xs font-medium uppercase tracking-wide text-stone-500">{product.category}</span>
        )}
        <h3 className="font-semibold text-stone-900">{product.name}</h3>
        <p className="text-sm font-medium text-brand-700">{priceLabel(product)}</p>
        {product.stock !== null && !product.soldOut && (
          <p className={cn("text-xs", product.stock <= 10 ? "text-amber-700" : "text-stone-500")} data-stock-count>
            {product.stock <= 10 ? `Only ${product.stock} left` : `${product.stock} in stock`}
          </p>
        )}
        <div className="mt-auto pt-2">
          <Button
            size="sm"
            variant={product.soldOut ? "secondary" : "primary"}
            disabled={product.soldOut}
            onClick={() => onQuickView(product)}
            className="w-full"
          >
            {product.soldOut ? "Sold out" : "Add to cart"}
          </Button>
        </div>
      </div>
    </li>
  );
}
