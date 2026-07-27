import { Button } from '@/components/ui/button';
import { Label, Select } from '@/components/ui/field';

/**
 * Which year the page is about. A plain GET form, so the choice ends up in the
 * URL and the office can bookmark last year's margin report or send it to
 * somebody.
 */
export function SeasonPicker({
  action,
  seasons,
  selectedId,
}: {
  action: string;
  seasons: { id: string; label: string }[];
  selectedId: string;
}) {
  return (
    <form method="get" action={action} className="flex items-end gap-3">
      <div>
        <Label htmlFor="seasonId">Season</Label>
        <Select id="seasonId" name="seasonId" defaultValue={selectedId} data-testid="season-picker">
          {seasons.map((season) => (
            <option key={season.id} value={season.id}>
              {season.label}
            </option>
          ))}
        </Select>
      </div>

      <Button type="submit" variant="secondary">
        Show
      </Button>
    </form>
  );
}
