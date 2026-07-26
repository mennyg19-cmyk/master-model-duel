import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Lets server code call forbidden()/unauthorized() so gated pages answer with
  // a real 403/401 status instead of redirecting to a look-alike page.
  experimental: {
    authInterrupts: true,
  },
};

export default nextConfig;
