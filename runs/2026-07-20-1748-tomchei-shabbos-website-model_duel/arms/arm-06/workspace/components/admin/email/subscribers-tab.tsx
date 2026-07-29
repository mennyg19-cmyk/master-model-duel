"use client";

import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api-fetch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export interface SubscriberRow {
  id: string;
  email: string;
  name: string | null;
  prefNewProducts: boolean;
  prefReminders: boolean;
  prefCommunity: boolean;
  unsubscribed: boolean;
  listIds: string[];
}

const PREF_LABELS = [
  ["prefNewProducts", "New products"],
  ["prefReminders", "Reminders"],
  ["prefCommunity", "Community"],
] as const;

interface PrefState {
  prefNewProducts: boolean;
  prefReminders: boolean;
  prefCommunity: boolean;
}

export function SubscribersTab({ subscribers }: { subscribers: SubscriberRow[] }) {
  const router = useRouter();

  async function save(subscriber: SubscriberRow, patch: { unsubscribeAll: boolean; prefs?: PrefState }) {
    await apiFetch(`/api/admin/email/subscribers/${subscriber.id}`, { method: "PATCH", body: patch });
    router.refresh();
  }

  return (
    <Card className="max-w-4xl p-5" data-subscribers-tab>
      <CardTitle>Subscribers</CardTitle>
      <table className="mt-3 w-full text-left text-sm" data-subscriber-list>
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase text-stone-500">
            <th className="py-2 pr-3">Email</th>
            <th className="py-2 pr-3">Preferences</th>
            <th className="py-2 pr-3">State</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {subscribers.map((subscriber) => (
            <tr key={subscriber.id} className="border-b border-stone-100 align-top" data-subscriber-row={subscriber.email}>
              <td className="py-2 pr-3">
                <span className="font-medium">{subscriber.email}</span>
                {subscriber.name && <span className="block text-xs text-stone-500">{subscriber.name}</span>}
              </td>
              <td className="py-2 pr-3">
                <span className="flex flex-col gap-1">
                  {PREF_LABELS.map(([field, label]) => (
                    <label key={field} className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={subscriber[field]}
                        disabled={subscriber.unsubscribed}
                        onChange={() =>
                          save(subscriber, {
                            unsubscribeAll: false,
                            prefs: {
                              prefNewProducts: field === "prefNewProducts" ? !subscriber.prefNewProducts : subscriber.prefNewProducts,
                              prefReminders: field === "prefReminders" ? !subscriber.prefReminders : subscriber.prefReminders,
                              prefCommunity: field === "prefCommunity" ? !subscriber.prefCommunity : subscriber.prefCommunity,
                            },
                          })
                        }
                        data-pref-toggle={`${subscriber.email}:${field}`}
                      />
                      {label}
                    </label>
                  ))}
                </span>
              </td>
              <td className="py-2 pr-3">
                <Badge tone={subscriber.unsubscribed ? "red" : "green"}>
                  {subscriber.unsubscribed ? "unsubscribed" : "active"}
                </Badge>
              </td>
              <td className="py-2">
                {subscriber.unsubscribed ? (
                  <Button size="sm" variant="secondary" onClick={() => save(subscriber, { unsubscribeAll: false })} data-resubscribe={subscriber.email}>
                    Resubscribe
                  </Button>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => save(subscriber, { unsubscribeAll: true })} data-unsubscribe={subscriber.email}>
                    Unsubscribe
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {subscribers.length === 0 && (
            <tr>
              <td colSpan={4} className="py-3 text-stone-500">
                No subscribers yet — the storefront footer form creates them.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Card>
  );
}
