import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";
import "./styles.css";

export const metadata: Metadata = {
  title: "Tomchei Shabbos | Operations",
  description: "P1 foundation and staff operations shell",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const content = isClerkConfigured() ? <ClerkProvider>{children}</ClerkProvider> : children;
  return (
    <html lang="en">
      <body>{content}</body>
    </html>
  );
}
