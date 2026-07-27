import { addToListAction, createListAction, removeFromListAction } from './actions';
import { EmailTabs } from '../email-tabs';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { FlashMessages } from '@/components/ui/flash';
import { requirePermission } from '@/lib/auth/staff';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Subscriber lists (R-084).
 *
 * A list is a hand-picked subset of the newsletter — shul gabbaim, past
 * drivers, the board. Only people who already subscribed can be put on one, so
 * a list can never be used to reach somebody who never asked to hear from us.
 */
export default async function SubscriberListsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; problem?: string }>;
}) {
  await requirePermission('email.manage');

  const [flash, lists] = await Promise.all([
    searchParams,
    db.subscriberList.findMany({
      orderBy: { name: 'asc' },
      include: {
        members: {
          orderBy: { addedAt: 'asc' },
          include: { subscriber: { select: { id: true, email: true, status: true } } },
        },
      },
    }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Lists</h1>
        <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
          Smaller groups inside the newsletter, for letters that are not for everybody.
        </p>
      </header>

      <EmailTabs active="/admin/email/lists" />
      <FlashMessages notice={flash.notice} problem={flash.problem} testIdPrefix="lists" />

      <Card>
        <CardTitle>New list</CardTitle>
        <CardDescription>
          People are added by their newsletter address. Somebody who has not subscribed cannot be
          added.
        </CardDescription>

        <form action={createListAction} className="mt-4 grid gap-4 sm:grid-cols-[1fr_2fr_auto]">
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" name="name" required placeholder="Shul gabbaim" />
          </div>
          <div>
            <Label htmlFor="description">What it is for</Label>
            <Input id="description" name="description" placeholder="One contact per shul" />
          </div>
          <div className="flex items-end">
            <Button type="submit">Create</Button>
          </div>
        </form>
      </Card>

      {lists.map((list) => (
        <Card key={list.id} data-testid="subscriber-list" data-slug={list.slug}>
          <CardTitle>{list.name}</CardTitle>
          <CardDescription>
            {list.description || 'No description.'} — {list.members.length} member
            {list.members.length === 1 ? '' : 's'}
          </CardDescription>

          <ul className="mt-3 divide-y divide-[var(--color-line)] text-sm">
            {list.members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  {member.subscriber.email}
                  {member.subscriber.status === 'SUBSCRIBED' ? null : (
                    <span className="ml-2 text-xs text-[var(--color-ink-muted)]">unsubscribed</span>
                  )}
                </span>
                <form action={removeFromListAction}>
                  <input type="hidden" name="listId" value={list.id} />
                  <input type="hidden" name="subscriberId" value={member.subscriber.id} />
                  <Button type="submit" variant="ghost">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>

          <form action={addToListAction} className="mt-4 flex flex-wrap items-end gap-3">
            <input type="hidden" name="listId" value={list.id} />
            <div className="min-w-64">
              <Label htmlFor={`email-${list.id}`}>Add an address</Label>
              <Input id={`email-${list.id}`} name="email" type="email" required />
            </div>
            <Button type="submit" variant="secondary">
              Add
            </Button>
          </form>
        </Card>
      ))}
    </div>
  );
}
