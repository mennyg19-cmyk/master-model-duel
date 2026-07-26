import Link from 'next/link';

import { Badge } from '@/components/ui/badge';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { BRAND } from '@/lib/brand';
import { readSetting } from '@/lib/settings';
import { seasonLabel, seasonYearFor } from '@/lib/core/season';

export const dynamic = 'force-dynamic';

export default async function StorefrontHomePage() {
  const isStoreOpen = await readSetting('store.open');
  const season = seasonLabel(seasonYearFor(new Date()));

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <Badge tone={isStoreOpen ? 'success' : 'warning'}>
          {isStoreOpen ? `${season} ordering is open` : `${season} ordering is not open yet`}
        </Badge>
        <h1 className="text-3xl font-semibold">{BRAND.productName}</h1>
        <p className="max-w-2xl text-[var(--color-ink-muted)]">{BRAND.tagline}</p>
      </section>

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardTitle>Choose your packages</CardTitle>
          <CardDescription>Pick from this season&apos;s collection.</CardDescription>
        </Card>
        <Card>
          <CardTitle>Name your recipients</CardTitle>
          <CardDescription>Deliver, ship or arrange a pickup for each one.</CardDescription>
        </Card>
        <Card>
          <CardTitle>We handle the rest</CardTitle>
          <CardDescription>Volunteers pack, print and deliver before Purim.</CardDescription>
        </Card>
      </section>

      <p className="text-sm text-[var(--color-ink-muted)]">
        Catalog and ordering arrive in a later release.{' '}
        <Link href="/admin" className="text-[var(--color-brand)] underline">
          Staff sign in
        </Link>
        .
      </p>
    </div>
  );
}
