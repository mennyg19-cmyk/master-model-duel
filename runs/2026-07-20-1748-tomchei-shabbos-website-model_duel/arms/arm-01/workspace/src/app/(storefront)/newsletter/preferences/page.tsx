import { NewsletterPreferences } from "@/components/newsletter-preferences";

export default async function NewsletterPreferencesPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;
  return (
    <main className="grid min-h-[65vh] place-items-center bg-[var(--cream)] px-5 py-16">
      <div className="w-full max-w-xl rounded-[2rem] border border-[var(--border)] bg-white p-8 shadow-xl sm:p-10">
        <p className="text-sm font-bold uppercase tracking-[0.2em] text-[var(--brand)]">
          Newsletter
        </p>
        <h1 className="mt-3 text-4xl font-black">Choose what reaches you.</h1>
        <div className="mt-7">
          <NewsletterPreferences token={token} />
        </div>
      </div>
    </main>
  );
}
