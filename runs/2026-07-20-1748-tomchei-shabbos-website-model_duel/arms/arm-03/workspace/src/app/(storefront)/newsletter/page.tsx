import { NewsletterForm } from "@/components/storefront/newsletter-form";

export default function NewsletterPage() {
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <h1 className="font-[family-name:var(--font-display)] text-4xl text-[var(--color-forest)]">
        Newsletter
      </h1>
      <p className="mt-2 text-sm text-[var(--color-ink)]/75">
        Season openings and community updates. Unsubscribe any time with a signed link.
      </p>
      <div className="mt-8 rounded-[var(--radius-lg)] bg-white p-5 shadow-sm">
        <NewsletterForm />
      </div>
    </main>
  );
}
