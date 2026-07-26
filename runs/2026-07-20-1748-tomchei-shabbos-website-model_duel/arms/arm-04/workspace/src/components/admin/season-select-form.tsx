/**
 * The season picker on the catalog pages. It is a GET form so every season has
 * its own URL and nothing needs client JavaScript; catalog and add-ons share it
 * so the two cannot drift apart.
 */
export function SeasonSelectForm({
  action,
  seasons,
  selectedYear,
}: {
  action: string;
  seasons: { id: string; year: number; label: string; status: string }[];
  selectedYear: number;
}) {
  return (
    <form method="get" action={action} className="flex items-end gap-2">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Season</span>
        <select
          name="season"
          defaultValue={String(selectedYear)}
          className="rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
        >
          {seasons.map((season) => (
            <option key={season.id} value={season.year}>
              {season.label} ({season.status.toLowerCase()})
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="rounded-md border border-[var(--color-line)] px-3 py-2 text-sm">
        Show
      </button>
    </form>
  );
}
