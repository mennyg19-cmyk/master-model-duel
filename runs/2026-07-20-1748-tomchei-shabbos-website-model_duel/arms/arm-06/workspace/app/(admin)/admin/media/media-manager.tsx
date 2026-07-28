"use client";

import { ChangeEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { ProductImage } from "@/components/product-image";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

interface ManagedAsset {
  id: string;
  url: string;
  filename: string;
  sizeBytes: number;
  productId: string | null;
  productName: string | null;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

// R-067: upload (multipart), per-asset product assignment, delete, and the
// needs-photos panel (active products with no photo yet — upload assigns
// directly when launched from that row).
export function MediaManager({
  assets,
  products,
  needsPhotos,
}: {
  assets: ManagedAsset[];
  products: { id: string; name: string }[];
  needsPhotos: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  async function upload(file: File, productId: string | null) {
    setIsUploading(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    if (productId) body.set("productId", productId);
    const response = await fetch("/api/admin/media", { method: "POST", body });
    const json = (await response.json().catch(() => ({}))) as { error?: string };
    setIsUploading(false);

    if (!response.ok) {
      setError(json.error ?? "Upload failed");
      return;
    }
    router.refresh();
  }

  function onFileChosen(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file, null);
  }

  function onNeedsPhotosFileChosen(event: ChangeEvent<HTMLInputElement>, productId: string) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) upload(file, productId);
  }

  async function assign(assetId: string, productId: string) {
    setError(null);
    const { ok, body } = await apiFetch(`/api/admin/media/${assetId}`, {
      method: "PATCH",
      body: { productId: productId || null },
    });
    if (!ok) {
      setError(body.error ?? "Could not assign the photo");
      return;
    }
    router.refresh();
  }

  async function remove(assetId: string) {
    setError(null);
    const { ok } = await apiFetch(`/api/admin/media/${assetId}`, { method: "DELETE" });
    if (!ok) {
      setError("Could not delete the photo");
      return;
    }
    router.refresh();
  }

  return (
    <div className="mt-6">
      <label className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-brand-700 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600">
        {isUploading ? "Uploading…" : "Upload photo"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="hidden"
          disabled={isUploading}
          onChange={onFileChosen}
        />
      </label>
      <p className="mt-2 text-xs text-stone-500">JPEG, PNG, WebP or GIF, up to 5 MB.</p>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <section className="mt-8">
        <h2 className="text-lg font-semibold">Needs photos</h2>
        {needsPhotos.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">Every active product has a photo.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {needsPhotos.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between rounded-md border border-stone-200 bg-white px-3 py-2 text-sm"
              >
                <span className="text-stone-800">{product.name}</span>
                <label className="cursor-pointer text-brand-700 hover:underline">
                  Upload photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    disabled={isUploading}
                    onChange={(event) => onNeedsPhotosFileChosen(event, product.id)}
                  />
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      {assets.length === 0 ? (
        <p className="mt-8 text-sm text-stone-500">No photos uploaded yet.</p>
      ) : (
        <ul className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-lg border border-stone-200 bg-white p-3">
              <ProductImage src={asset.url} alt={asset.filename} className="h-28 w-full rounded-md object-cover" />
              <p className="mt-2 truncate text-xs font-medium text-stone-800" title={asset.filename}>
                {asset.filename}
              </p>
              <p className="text-xs text-stone-500">{formatBytes(asset.sizeBytes)}</p>
              <div className="mt-2 flex items-center gap-2">
                <Select
                  aria-label="Assign to product"
                  value={asset.productId ?? ""}
                  onChange={(event) => assign(asset.id, event.target.value)}
                  className="flex-1"
                >
                  <option value="">— unassigned —</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => remove(asset.id)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
