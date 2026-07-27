import { Label, Select } from '@/components/ui/field';
import { NEWSLETTER_PREFERENCES } from '@/lib/newsletter/preferences';

/**
 * Who a campaign goes to, on both the new-draft form and the campaign page.
 * Two selects with the same options in both places, so a draft cannot be
 * created with an audience it can never be edited to.
 */
export function CampaignAudienceFields({
  lists,
  selected,
}: {
  lists: { id: string; name: string }[];
  selected?: { listId: string | null; preferenceKey: string | null };
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div>
        <Label htmlFor="listId">List</Label>
        <Select id="listId" name="listId" defaultValue={selected?.listId ?? ''}>
          <option value="">Everyone subscribed</option>
          {lists.map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label htmlFor="preferenceKey">Only people who asked for</Label>
        <Select id="preferenceKey" name="preferenceKey" defaultValue={selected?.preferenceKey ?? ''}>
          <option value="">Anything at all</option>
          {Object.entries(NEWSLETTER_PREFERENCES).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
