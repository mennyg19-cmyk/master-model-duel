"use client";

import { useRouter } from "next/navigation";
import { Season, SeasonStatus } from "@prisma/client";
import { Select } from "@/components/ui/select";

// R-065: season select drives the catalog list via the ?season= query param
// (server-rendered list, shareable URL).
export function SeasonSelect({
  seasons,
  selectedSeasonId,
}: {
  seasons: Pick<Season, "id" | "name" | "status">[];
  selectedSeasonId: string | null;
}) {
  const router = useRouter();

  return (
    <label className="flex items-center gap-2 text-sm text-stone-600">
      Season
      <Select
        aria-label="Season"
        value={selectedSeasonId ?? ""}
        onChange={(event) => router.push(`/admin/products?season=${event.target.value}`)}
      >
        {seasons.map((season) => (
          <option key={season.id} value={season.id}>
            {season.name}
            {season.status === SeasonStatus.OPEN ? " (open)" : ""}
          </option>
        ))}
      </Select>
    </label>
  );
}
