"use client";

import Image from "next/image";
import { useState } from "react";

type MediaAsset = {
  id: string;
  pathname: string;
  url: string;
  contentType: string;
  sizeBytes: number;
};

type ProductWithoutPhoto = {
  id: string;
  name: string;
  sku: string;
  version: number;
};

export function MediaManager({
  initialAssets,
  initialProductsWithoutPhotos,
}: {
  initialAssets: MediaAsset[];
  initialProductsWithoutPhotos: ProductWithoutPhoto[];
}) {
  const [assets, setAssets] = useState(initialAssets);
  const [productsWithoutPhotos, setProductsWithoutPhotos] = useState(
    initialProductsWithoutPhotos,
  );
  const [selectedAssetUrl, setSelectedAssetUrl] = useState(initialAssets[0]?.url ?? "");
  const [message, setMessage] = useState("");

  async function uploadImage(formData: FormData) {
    const response = await fetch("/api/admin/media", {
      method: "POST",
      body: formData,
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setAssets((current) => [payload.mediaAsset, ...current]);
    setSelectedAssetUrl(payload.mediaAsset.url);
    setMessage("Image uploaded and ready to use.");
  }

  async function assignPhoto(product: ProductWithoutPhoto) {
    if (!selectedAssetUrl) {
      setMessage("Select or upload an image before assigning it.");
      return;
    }
    const response = await fetch("/api/admin/catalog", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: product.id,
        version: product.version,
        imageUrl: selectedAssetUrl,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error);
      return;
    }
    setProductsWithoutPhotos((current) =>
      current.filter((candidate) => candidate.id !== product.id),
    );
    setMessage(`Assigned the selected image to ${product.name}.`);
  }

  return (
    <div>
      <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
        Storefront assets
      </p>
      <h1 className="mt-2 text-4xl font-black">Media library</h1>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_0.85fr]">
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <h2 className="text-xl font-bold">Images</h2>
          <form action={uploadImage} className="mt-5 flex flex-col gap-3 sm:flex-row">
            <input
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="min-w-0 flex-1 rounded-xl border border-[var(--border)] px-3 py-2.5"
              name="file"
              required
              type="file"
            />
            <button className="rounded-xl bg-[var(--ink)] px-5 py-3 font-bold text-white" type="submit">
              Upload
            </button>
          </form>
          <p className="mt-2 text-xs text-[var(--muted)]">JPEG, PNG, WebP, or GIF. Maximum 5 MB.</p>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {assets.map((asset) => (
              <button
                className={`overflow-hidden rounded-2xl border-2 ${selectedAssetUrl === asset.url ? "border-[var(--brand)]" : "border-transparent"}`}
                key={asset.id}
                onClick={() => setSelectedAssetUrl(asset.url)}
                type="button"
              >
                <Image
                  alt={asset.pathname}
                  className="aspect-square w-full bg-[var(--surface)] object-cover"
                  height={220}
                  src={asset.url}
                  unoptimized
                  width={220}
                />
                <span className="block truncate px-2 py-2 text-xs">{asset.pathname}</span>
              </button>
            ))}
          </div>
          {assets.length === 0 && (
            <p className="mt-6 rounded-2xl bg-[var(--surface)] p-8 text-center text-[var(--muted)]">
              No images uploaded yet.
            </p>
          )}
        </section>
        <section className="rounded-3xl border border-[var(--border)] bg-white p-6">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-bold">Needs photos</h2>
            <span className="rounded-full bg-[var(--brand-soft)] px-3 py-1 text-sm font-bold text-[var(--brand-dark)]">
              {productsWithoutPhotos.length}
            </span>
          </div>
          <div className="mt-5 space-y-3">
            {productsWithoutPhotos.map((product) => (
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-[var(--border)] p-4" key={product.id}>
                <div>
                  <p className="font-bold">{product.name}</p>
                  <p className="text-xs text-[var(--muted)]">{product.sku}</p>
                </div>
                <button
                  className="rounded-xl bg-[var(--brand-soft)] px-3 py-2 text-sm font-bold text-[var(--brand-dark)]"
                  onClick={() => assignPhoto(product)}
                  type="button"
                >
                  Assign selected
                </button>
              </div>
            ))}
            {productsWithoutPhotos.length === 0 && (
              <p className="rounded-2xl bg-[#eef6ec] p-6 text-center font-semibold text-[#35633d]">
                Every active gift has a photo.
              </p>
            )}
          </div>
        </section>
      </div>
      {message && (
        <p aria-live="polite" className="mt-4 rounded-xl bg-[var(--brand-soft)] px-4 py-3 text-sm font-semibold">
          {message}
        </p>
      )}
    </div>
  );
}
