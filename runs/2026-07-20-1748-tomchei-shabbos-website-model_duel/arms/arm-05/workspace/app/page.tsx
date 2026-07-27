import Link from "next/link";
import { StorefrontShell } from "@/app/components/storefront-shell";
import { getStorefront } from "@/lib/storefront";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { currentSeason } = await getStorefront();
  const isOpen = Boolean(currentSeason);
  return (
    <StorefrontShell isOpen={isOpen}>
      <main>
        <p className="eyebrow">Purim gifts with purpose</p>
        <h1>Send joy. Strengthen Shabbos.</h1>
        <p className="lead">Every mishloach manos order helps Tomchei Shabbos bring dignity, food, and warmth to local families.</p>
        <div className="hero-actions">
          {isOpen ? <Link className="button" href="/catalog">Shop {currentSeason?.name}</Link> : <Link className="button" href="/collections">Browse past collections</Link>}
          <Link className="button secondary" href="/admin">Staff portal</Link>
        </div>
        <section className="impact-bar"><strong>1,200+</strong> families supported last year <strong>4,800</strong> Shabbos tables prepared <strong>100%</strong> community-powered</section>
        <div className="grid">
          <section className="card"><h2>Choose a gift</h2><p>Pick a package that feels personal and meaningful.</p></section>
          <section className="card"><h2>We pack with care</h2><p>Each box is prepared by neighbors and volunteers.</p></section>
          <section className="card"><h2>Share Purim joy</h2><p>We deliver your gift and put your support to work locally.</p></section>
        </div>
        <section className="testimonials"><p>“The boxes arrived beautifully prepared, and knowing the impact behind them made Purim feel fuller.”</p><strong>— A Tomchei Shabbos supporter</strong></section>
      </main>
    </StorefrontShell>
  );
}
