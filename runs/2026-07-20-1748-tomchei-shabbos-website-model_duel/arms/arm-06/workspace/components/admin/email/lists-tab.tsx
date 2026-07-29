"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ListRow } from "@/components/admin/email/campaigns-tab";
import { SubscriberRow } from "@/components/admin/email/subscribers-tab";

export function ListsTab({ lists, subscribers }: { lists: ListRow[]; subscribers: SubscriberRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [memberPick, setMemberPick] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function createList(event: FormEvent) {
    event.preventDefault();
    const result = await apiFetch("/api/admin/email/lists", { method: "POST", body: { name } });
    if (!result.ok) {
      setError(result.body.error ?? "Could not create the list");
      return;
    }
    setName("");
    setError(null);
    router.refresh();
  }

  async function addMember(listId: string) {
    const subscriberId = memberPick[listId];
    if (!subscriberId) return;
    await apiFetch(`/api/admin/email/lists/${listId}/members`, { method: "POST", body: { subscriberId } });
    router.refresh();
  }

  async function removeMember(listId: string, subscriberId: string) {
    await apiFetch(`/api/admin/email/lists/${listId}/members`, { method: "DELETE", body: { subscriberId } });
    router.refresh();
  }

  return (
    <div className="grid max-w-5xl gap-6 lg:grid-cols-[1fr_320px]" data-lists-tab>
      <div className="flex flex-col gap-4">
        {lists.map((list) => (
          <Card key={list.id} className="p-5" data-list-card={list.name}>
            <div className="flex items-center justify-between">
              <CardTitle>{list.name}</CardTitle>
              <Badge>{list.members.length} member(s)</Badge>
            </div>
            {list.description && <p className="mt-1 text-sm text-stone-600">{list.description}</p>}
            <ul className="mt-3 flex flex-col gap-1 text-sm" data-list-members={list.id}>
              {list.members.map((member) => (
                <li key={member.subscriberId} className="flex items-center justify-between gap-2">
                  <span>
                    {member.email}
                    {member.name ? ` · ${member.name}` : ""}
                    {member.unsubscribed && (
                      <Badge tone="red" className="ml-2">
                        unsubscribed
                      </Badge>
                    )}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => removeMember(list.id, member.subscriberId)} data-remove-member={`${list.id}:${member.subscriberId}`}>
                    Remove
                  </Button>
                </li>
              ))}
              {list.members.length === 0 && <li className="text-stone-500">Empty list.</li>}
            </ul>
            <div className="mt-3 flex gap-2">
              <select
                className="w-full rounded-md border border-stone-300 px-3 py-2 text-sm"
                value={memberPick[list.id] ?? ""}
                onChange={(event) => setMemberPick((current) => ({ ...current, [list.id]: event.target.value }))}
                data-member-pick={list.id}
              >
                <option value="">Add a subscriber…</option>
                {subscribers
                  .filter((subscriber) => !list.members.some((member) => member.subscriberId === subscriber.id))
                  .map((subscriber) => (
                    <option key={subscriber.id} value={subscriber.id}>
                      {subscriber.email}
                    </option>
                  ))}
              </select>
              <Button size="sm" variant="secondary" onClick={() => addMember(list.id)} data-add-member={list.id}>
                Add
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="h-fit p-5">
        <CardTitle>New list</CardTitle>
        <form className="mt-3 flex flex-col gap-3" onSubmit={createList} data-list-create-form>
          <div>
            <Label htmlFor="list-name">Name</Label>
            <Input id="list-name" value={name} onChange={(event) => setName(event.target.value)} required data-list-name />
          </div>
          {error && <p className="text-sm text-red-700">{error}</p>}
          <Button type="submit" data-list-create>
            Create list
          </Button>
        </form>
      </Card>
    </div>
  );
}
