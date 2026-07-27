import { StorefrontShell } from "@/app/components/storefront-shell";
import { formatMoney, getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function CollectionsPage() {
  const { currentSeason, archives } = await getStorefront();
  return (
    <StorefrontShell isOpen={Boolean(currentSeason)}>
      <main>
        <p className="eyebrow">Past collections</p>
        <h1>Remember Purims past.</h1>
        <p className="lead">Every collection stays here to browse. Archived products are never available for checkout.</p>
        {archives.map((season) => (
          <section className="archive" key={season.id}>
            <h2>{season.name}</h2>
            <div className="catalog-grid">
              {season.products.map((product) => (
                <article className="product-card" key={product.id}>
                  {product.media ? <img alt="" src={product.media.url} /> : <div className="product-placeholder">Purim collection</div>}
                  <h3>{product.name}</h3>
                  <p>{product.description}</p>
                  <strong>{formatMoney(product.priceCents)}</strong>
                  <p className="archived">Archived collection · not available to buy</p>
                </article>
              ))}
            </div>
          </section>
        ))}
        {archives.length === 0 && <p className="notice">Past collections will appear here when this season closes.</p>}
      </main>
    </StorefrontShell>
  );
}
