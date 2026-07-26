'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';
import { reportClientError } from '@/lib/report-client-error';

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);

  return (
    <div className="mx-auto max-w-xl px-4 py-16">
      <h1 className="text-2xl font-semibold">This page hit an error</h1>
      <p className="mt-2 text-[var(--color-ink-muted)]">
        Nothing was saved. Try again, and contact support if it keeps happening.
        {error.digest ? ` Reference: ${error.digest}` : ''}
      </p>
      <Button className="mt-6" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
