import type { Result } from '../core/result';
import type { PrintedDocument } from './print-render';

/**
 * How printed paper leaves the server.
 *
 * Inline rather than an attachment: staff press Ctrl-P on the tab they are
 * looking at, and a downloads folder full of `slips.pdf` helps nobody. Nothing
 * is cached — a batch's membership can be reprinted, and the browser must not
 * serve yesterday's copy of a document rendered from today's rows.
 */
export function pdfResponse(rendered: Result<PrintedDocument>): Response {
  if (!rendered.ok) {
    return new Response(rendered.publicMessage, {
      status: 404,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(new Uint8Array(rendered.value.bytes), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename="${rendered.value.fileName}"`,
      'cache-control': 'no-store',
    },
  });
}
