import Link from "next/link";

// Shared Prev/Next for the admin list pages (R-105 shared controls): one
// markup, one hover style; the page supplies the href builder. Renders
// nothing for a single page.
export function PaginationNav({
  page,
  pages,
  href,
  dataAttr,
}: {
  page: number;
  pages: number;
  href: (target: number) => string;
  dataAttr?: string;
}) {
  if (pages <= 1) return null;
  return (
    <nav
      className="mt-4 flex items-center gap-2 text-sm"
      aria-label="Pagination"
      {...(dataAttr ? { [dataAttr]: true } : {})}
    >
      {page > 1 && (
        <Link href={href(page - 1)} className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100">
          ← Prev
        </Link>
      )}
      <span className="text-stone-600">
        {page} / {pages}
      </span>
      {page < pages && (
        <Link href={href(page + 1)} className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100">
          Next →
        </Link>
      )}
    </nav>
  );
}
