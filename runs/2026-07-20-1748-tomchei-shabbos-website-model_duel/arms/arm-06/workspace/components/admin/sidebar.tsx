"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

export interface SidebarItem {
  href: string;
  label: string;
}

export function Sidebar({ items }: { items: SidebarItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto bg-brand-900 px-4 py-2 md:w-52 md:flex-col md:px-3 md:py-4">
      {items.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium text-brand-100 hover:bg-brand-700 hover:text-white",
              isActive && "bg-brand-700 text-white",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
