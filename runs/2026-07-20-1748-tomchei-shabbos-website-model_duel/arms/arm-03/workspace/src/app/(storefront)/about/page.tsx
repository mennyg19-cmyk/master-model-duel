import { brand } from "@/lib/brand";

export default function AboutPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        About {brand.name}
      </h1>
      <p className="mt-4 text-[var(--color-ink)]/80">
        We organize mishloach manot so every family can give and receive with dignity. Volunteers,
        donors, and staff share one mission: food for families.
      </p>
    </main>
  );
}
