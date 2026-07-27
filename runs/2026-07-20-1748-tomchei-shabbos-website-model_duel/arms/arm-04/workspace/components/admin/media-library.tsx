"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";

type AssetRow = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
  storage: string;
  products: { id: string; name: string }[];
};
type NeedsPhotoProduct = { id: string; name: string; seasonName: string };

export function MediaLibrary({
  needsPhotos,
  initialAssets,
}: {
  needsPhotos: NeedsPhotoProduct[];
  initialAssets: AssetRow[];
}) {
  const [assets, setAssets] = useState<AssetRow[]>(initialAssets);
  const [message, setMessage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const reload = useCallback(async () => {
    const response = await fetch("/api/admin/media");
    if (response.ok) setAssets(await response.json());
  }, []);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/admin/media", { method: "POST", body: formData });
      const body = await response.json();
      setMessage(response.ok ? `Uploaded ${body.asset.filename}.` : body.error ?? "Upload failed.");
      fileInput.value = "";
      await reload();
    } finally {
      setUploading(false);
    }
  }

  async function attach(productId: string, imageId: string) {
    setMessage(null);
    const response = await fetch(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageId }),
    });
    const body = await response.json();
    setMessage(response.ok ? "Photo attached. Refresh to update the needs-photos list." : body.error ?? "Attach failed.");
    await reload();
  }

  async function remove(assetId: string) {
    setMessage(null);
    const response = await fetch(`/api/admin/media/${assetId}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) setMessage(body.error ?? "Delete failed.");
    await reload();
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Upload</CardTitle>
        <p className="mb-3 text-sm text-muted">
          PNG, JPEG, GIF, or WebP up to 5 MB. Files are checked by content, not just filename.
        </p>
        <form onSubmit={upload} className="flex items-center gap-3">
          <input type="file" name="file" accept="image/*" required className="text-sm" />
          <Button type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
        </form>
        {message && <p className="mt-3 text-sm font-medium">{message}</p>}
      </Card>

      {needsPhotos.length > 0 && (
        <Card>
          <CardTitle>Needs photos ({needsPhotos.length})</CardTitle>
          <p className="mb-3 text-sm text-muted">Active products without a photo (R-180). Attach one from the library below.</p>
          <ul className="space-y-2 text-sm">
            {needsPhotos.map((product) => (
              <li key={product.id} className="flex items-center gap-3">
                <span>{product.name}</span>
                <span className="text-xs text-muted">{product.seasonName}</span>
                <Select
                  aria-label={`Attach photo to ${product.name}`}
                  defaultValue=""
                  onChange={(event) => event.target.value && attach(product.id, event.target.value)}
                  className="ml-auto max-w-52 text-xs"
                >
                  <option value="" disabled>Attach a photo…</option>
                  {assets.map((asset) => (
                    <option key={asset.id} value={asset.id}>{asset.filename}</option>
                  ))}
                </Select>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Library ({assets.length})</CardTitle>
        <ul className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="rounded-lg border border-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.filename} className="h-28 w-full rounded object-cover" />
              <p className="mt-2 truncate text-xs font-medium" title={asset.filename}>{asset.filename}</p>
              <p className="text-xs text-muted">
                {(asset.sizeBytes / 1024).toFixed(0)} KB · {asset.storage}
                {asset.products.length > 0 && ` · on ${asset.products.map((product) => product.name).join(", ")}`}
              </p>
              <Button variant="danger" className="mt-2 w-full" onClick={() => remove(asset.id)}>
                Delete
              </Button>
            </li>
          ))}
          {assets.length === 0 && <li className="text-sm text-muted">Nothing uploaded yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
