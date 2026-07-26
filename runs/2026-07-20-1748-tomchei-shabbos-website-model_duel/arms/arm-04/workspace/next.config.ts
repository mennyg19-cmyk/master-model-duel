import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Catalog photos come back from Vercel Blob on a per-store subdomain. Local
  // uploads are served from /uploads and need no entry here.
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
  // Lets server code call forbidden()/unauthorized() so gated pages answer with
  // a real 403/401 status instead of redirecting to a look-alike page.
  experimental: {
    authInterrupts: true,
    // The media library accepts images up to 5 MB, and the default action body
    // limit is 1 MB — a photo would be rejected by the framework before the
    // upload rules ever ran.
    serverActions: { bodySizeLimit: '6mb' },
  },
};

export default nextConfig;
