/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client"],
  // forbidden()/unauthorized() + forbidden.tsx 403 boundary (Next 15.x flag).
  experimental: { authInterrupts: true },
};

export default nextConfig;
