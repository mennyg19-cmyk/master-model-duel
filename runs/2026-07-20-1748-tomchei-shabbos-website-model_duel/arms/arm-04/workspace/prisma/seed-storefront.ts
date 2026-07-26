import type { Season } from '@prisma/client';

import { normalizeEmail } from '../src/lib/core/normalize';
import { db } from '../src/lib/db';
import { buildPathname } from '../src/lib/media/validation';
import { storeImage } from '../src/lib/media/storage';
import { writeSetting } from '../src/lib/settings';
import { createSolidPng } from '../scripts/png';

/**
 * What the storefront needs before it is worth looking at: an open store, a
 * delivery area, product photos, and a newsletter with someone on it.
 *
 * One product is left without a photo on purpose, so the admin needs-photos
 * panel has something to show.
 */
const PHOTOS = [
  {
    slug: 'classic-mishloach-manos',
    altText: 'A classic mishloach manos box tied with a ribbon',
    rgb: [198, 132, 74],
  },
  {
    slug: 'deluxe-wine-basket',
    altText: 'A lined basket of wine, dried fruit and chocolate',
    rgb: [122, 40, 58],
  },
] as const;

const SUBSCRIBERS = [
  {
    email: 'subscriber@example.com',
    status: 'SUBSCRIBED',
    wantsImpactStories: true,
    source: 'seed',
  },
  {
    email: 'moved-on@example.com',
    status: 'UNSUBSCRIBED',
    wantsImpactStories: false,
    source: 'seed',
  },
] as const;

/** Lakewood, Toms River and Monsey — the towns the demo addresses sit in. */
const DELIVERY_ZIPS = ['08701', '08753', '10952'];

const PHOTO_PIXELS = 600;

export async function seedStorefront(season: Season): Promise<void> {
  await seedSettings();
  await seedProductPhotos(season);
  await seedSubscribers();
}

async function seedSettings(): Promise<void> {
  await writeSetting('store.open', true);
  await writeSetting('brand.announcement', 'Orders close Sunday night — thank you for giving.');
  await writeSetting('orders.followUpDays', 3);
  await writeSetting('shipping.deliveryZips', DELIVERY_ZIPS);
  await writeSetting('shipping.baseRateCents', 1200);
  await writeSetting('shipping.freeShippingThresholdCents', 15000);
  await writeSetting('email.fromName', 'Tomchei Shabbos');
  await writeSetting('email.fromAddress', 'orders@tomchei.example');
  await writeSetting('email.replyToAddress', 'office@tomchei.example');
}

async function seedProductPhotos(season: Season): Promise<void> {
  for (const photo of PHOTOS) {
    const product = await db.product.findUnique({
      where: { seasonId_slug: { seasonId: season.id, slug: photo.slug } },
    });
    if (!product || product.imageAssetId) continue;

    const bytes = createSolidPng(PHOTO_PIXELS, PHOTO_PIXELS, photo.rgb);
    const pathname = buildPathname({
      originalFilename: `${photo.slug}.png`,
      extension: 'png',
      uniqueSuffix: 'seed',
      seasonYear: season.year,
    });

    const stored = await storeImage(pathname, bytes, 'image/png');

    const asset = await db.mediaAsset.upsert({
      where: { pathname: stored.pathname },
      create: {
        storage: stored.storage,
        pathname: stored.pathname,
        url: stored.url,
        originalFilename: `${photo.slug}.png`,
        contentType: 'image/png',
        sizeBytes: bytes.byteLength,
        altText: photo.altText,
      },
      update: { url: stored.url, altText: photo.altText },
    });

    await db.product.update({
      where: { id: product.id },
      data: { imageAssetId: asset.id },
    });
  }
}

async function seedSubscribers(): Promise<void> {
  for (const subscriber of SUBSCRIBERS) {
    const normalizedEmail = normalizeEmail(subscriber.email);

    await db.newsletterSubscriber.upsert({
      where: { normalizedEmail },
      create: {
        email: subscriber.email,
        normalizedEmail,
        status: subscriber.status,
        wantsImpactStories: subscriber.wantsImpactStories,
        source: subscriber.source,
        unsubscribedAt: subscriber.status === 'UNSUBSCRIBED' ? new Date() : null,
      },
      update: {},
    });
  }
}
