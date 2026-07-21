"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type Media = { id: string; filename: string; url: string; contentType: string; byteSize: number };
type Need = { id: string; name: string; sku: string; season: { name: string } };
type ProductOption = { id: string; name: string; sku: string };

export function MediaAdmin() {
  const [media, setMedia] = useState<Media[]>([]);
  const [needsPhotos, setNeedsPhotos] = useState<Need[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [linkProductId, setLinkProductId] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    const [mediaRes, catalogRes] = await Promise.all([
      fetch("/api/admin/media"),
      fetch("/api/admin/catalog"),
    ]);
    const mediaJson = await mediaRes.json();
    const catalogJson = await catalogRes.json();
    if (mediaRes.ok) {
      setMedia(mediaJson.media);
      setNeedsPhotos(mediaJson.needsPhotos);
    }
    if (catalogRes.ok) {
      const opts = (catalogJson.products || []).map(
        (p: { id: string; name: string; sku: string }) => ({
          id: p.id,
          name: p.name,
          sku: p.sku,
        }),
      );
      setProducts(opts);
      if (!linkProductId && opts[0]) setLinkProductId(opts[0].id);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setMessage(null);
    const form = e.currentTarget;
    const data = new FormData(form);
    if (linkProductId) data.set("productId", linkProductId);
    const res = await fetch("/api/admin/media", { method: "POST", body: data });
    const json = await res.json();
    if (res.ok) {
      const linked = json.link ? ` · linked to product ${json.link.productId}` : "";
      setMessage(`Uploaded ${json.media.filename}${linked}`);
      form.reset();
      await load();
    } else {
      setMessage(json.error || "Upload failed");
    }
  }

  async function linkExisting(mediaAssetId: string) {
    if (!linkProductId) {
      setMessage("Select a product to link first.");
      return;
    }
    setMessage(null);
    const res = await fetch("/api/admin/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ intent: "link", productId: linkProductId, mediaAssetId }),
    });
    const json = await res.json();
    if (!res.ok) {
      setMessage(json.error || "Link failed");
      return;
    }
    setMessage(`Linked media to product ${json.link.productId}`);
    await load();
  }

  return (
    <div className="space-y-6">
      <form onSubmit={onUpload} className="space-y-3 rounded bg-white p-4 shadow-sm" data-testid="media-upload">
        <h2 className="font-semibold">Media library</h2>
        <p className="text-xs text-[var(--color-ink)]/60">
          Allowed: JPEG, PNG, WebP, GIF · max 5 MB · extension must match MIME · stored via local Blob stand-in
        </p>
        <label className="block text-sm">
          Link to product (sets primaryImageUrl + mediaAssetId)
          <select
            className="mt-1 w-full rounded border px-2 py-1.5"
            value={linkProductId}
            onChange={(e) => setLinkProductId(e.target.value)}
            data-testid="media-link-product"
          >
            <option value="">— none —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.sku})
              </option>
            ))}
          </select>
        </label>
        <input type="file" name="file" accept="image/jpeg,image/png,image/webp,image/gif" required />
        <input className="w-full rounded border px-2 py-1.5 text-sm" name="altText" placeholder="Alt text" />
        <Button type="submit">Upload</Button>
        {message ? <p className="text-sm" data-testid="media-message">{message}</p> : null}
      </form>

      <section>
        <h3 className="font-semibold">Needs photos</h3>
        <ul className="mt-2 space-y-1 text-sm" data-testid="needs-photos">
          {needsPhotos.length === 0 ? <li>All active products have photos.</li> : null}
          {needsPhotos.map((p) => (
            <li key={p.id} className="rounded bg-white px-3 py-2 shadow-sm">
              {p.name} ({p.sku}) — {p.season.name}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h3 className="font-semibold">Library</h3>
        <ul className="mt-2 grid gap-2 sm:grid-cols-2">
          {media.map((m) => (
            <li key={m.id} className="rounded bg-white p-3 text-sm shadow-sm">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={m.url} alt={m.filename} className="mb-2 h-28 w-full object-cover rounded" />
              {m.filename} · {(m.byteSize / 1024).toFixed(1)} KB
              <div className="mt-2">
                <Button type="button" variant="secondary" onClick={() => void linkExisting(m.id)}>
                  Link to selected product
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
