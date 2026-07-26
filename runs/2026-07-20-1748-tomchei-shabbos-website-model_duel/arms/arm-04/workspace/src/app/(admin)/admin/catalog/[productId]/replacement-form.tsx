'use client';

import { useActionState } from 'react';

import { setReplacementAction, type CatalogFormState } from '../actions';
import { Button } from '@/components/ui/button';

const INITIAL_STATE: CatalogFormState = { error: null, notice: null };

export function ReplacementForm({
  productId,
  replacedByProductId,
  candidates,
}: {
  productId: string;
  replacedByProductId: string | null;
  candidates: { id: string; label: string }[];
}) {
  const [state, formAction, isPending] = useActionState(setReplacementAction, INITIAL_STATE);

  return (
    <form action={formAction} className="mt-4 flex flex-wrap items-end gap-3">
      <input type="hidden" name="productId" value={productId} />
      <label className="text-sm">
        <span className="mb-1 block font-medium">Replacement</span>
        <select
          name="replacedByProductId"
          defaultValue={replacedByProductId ?? ''}
          className="min-w-72 rounded-md border border-[var(--color-line)] bg-white px-3 py-2 text-sm"
        >
          <option value="">No replacement</option>
          {candidates.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.label}
            </option>
          ))}
        </select>
      </label>
      <Button type="submit" variant="secondary" disabled={isPending}>
        {isPending ? 'Saving…' : 'Save link'}
      </Button>

      {state.error ? (
        <p
          role="alert"
          className="w-full text-sm text-[var(--color-danger)]"
          data-testid="replacement-error"
        >
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p
          className="w-full text-sm text-[var(--color-success)]"
          data-testid="replacement-notice"
        >
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
