import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Enables forbidden()/unauthorized() so permission gates return real 403/401 statuses.
    authInterrupts: true,
  },
};

export default nextConfig;
