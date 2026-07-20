import type { NextConfig } from "next";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Missing environment variable DATABASE_URL. Copy .env.example to .env and set it before starting the app.",
  );
}

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
      },
    ],
  },
};

export default nextConfig;
