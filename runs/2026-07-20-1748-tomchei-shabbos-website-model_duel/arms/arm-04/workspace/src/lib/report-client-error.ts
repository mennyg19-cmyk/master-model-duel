/**
 * One crash-report call for both error boundaries. `/api/client-error` bounds
 * and truncates whatever it receives; the report is best effort, because a
 * failed report must never replace the crash screen the user is looking at.
 */
export function reportClientError(error: Error & { digest?: string }): void {
  void fetch('/api/client-error', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: error.message.slice(0, 500),
      digest: error.digest,
      path: window.location.pathname,
    }),
  }).catch(() => {});
}
