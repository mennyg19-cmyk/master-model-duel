import Link from 'next/link';

import { ARTIFACT_LABELS, PRINT_ARTIFACTS } from '@/lib/print/documents';
import { orderArtifactPath } from '@/lib/print/paths';

/**
 * One order's slips, labels and cards (R-056), linked the same way wherever the
 * order is on screen. Reading them changes nothing about the boxes.
 */
export function OrderPrintLinks({ orderId }: { orderId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      {PRINT_ARTIFACTS.map((artifact) => (
        <Link
          key={artifact}
          href={orderArtifactPath(orderId, artifact)}
          className="text-[var(--color-brand)] underline underline-offset-4"
          data-testid={`order-print-${artifact}`}
        >
          {ARTIFACT_LABELS[artifact]}
        </Link>
      ))}
    </div>
  );
}
