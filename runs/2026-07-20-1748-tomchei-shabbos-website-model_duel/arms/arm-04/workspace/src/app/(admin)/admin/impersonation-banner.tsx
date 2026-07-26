import { endImpersonation } from './staff/actions';

export function ImpersonationBanner({
  actorName,
  impersonatedName,
}: {
  actorName: string;
  impersonatedName: string;
}) {
  return (
    <div
      data-testid="impersonation-banner"
      className="flex items-center justify-between gap-4 bg-[var(--color-warning-soft)] px-4 py-2 text-sm text-[var(--color-warning)]"
    >
      <span>
        <strong>{actorName}</strong> is signed in as <strong>{impersonatedName}</strong>. Every action
        is recorded under both names.
      </span>
      <form action={endImpersonation}>
        <button type="submit" className="font-medium underline">
          Stop impersonating
        </button>
      </form>
    </div>
  );
}
