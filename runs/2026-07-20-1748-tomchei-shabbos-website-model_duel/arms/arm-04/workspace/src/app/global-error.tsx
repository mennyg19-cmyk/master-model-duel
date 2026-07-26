'use client';

import { useEffect } from 'react';

import { reportClientError } from '@/lib/report-client-error';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError(error), [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', padding: '3rem', color: '#1c1917' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 600 }}>Something went wrong</h1>
        <p style={{ marginTop: '0.75rem', color: '#6b6560' }}>
          The page could not be displayed. The team has been notified.
          {error.digest ? ` Reference: ${error.digest}` : ''}
        </p>
        <button
          onClick={reset}
          style={{
            marginTop: '1.5rem',
            background: '#7b2d3b',
            color: '#fff',
            border: 0,
            borderRadius: '0.375rem',
            padding: '0.5rem 0.875rem',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </body>
    </html>
  );
}
