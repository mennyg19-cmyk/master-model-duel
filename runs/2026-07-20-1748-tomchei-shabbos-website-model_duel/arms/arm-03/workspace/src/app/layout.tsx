import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { brand } from "@/lib/brand";
import { getEnv } from "@/lib/env";
import "./globals.css";

export const metadata: Metadata = {
  title: brand.name,
  description: brand.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  let authMode: "clerk" | "dev" = "dev";
  try {
    authMode = getEnv().AUTH_MODE;
  } catch {
    authMode = "dev";
  }

  const tree = (
    <html lang="en">
      <body>{children}</body>
    </html>
  );

  if (authMode === "clerk") {
    return <ClerkProvider>{tree}</ClerkProvider>;
  }
  return tree;
}
