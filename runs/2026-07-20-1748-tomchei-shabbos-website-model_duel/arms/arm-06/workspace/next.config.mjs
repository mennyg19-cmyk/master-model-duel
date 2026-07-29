/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // forbidden()/unauthorized() + forbidden.tsx 403 boundary (Next 15.x flag).
  experimental: { authInterrupts: true },
  // Baseline security headers on every response: no framing (clickjacking),
  // no MIME sniffing, no full-URL referrers cross-origin.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
