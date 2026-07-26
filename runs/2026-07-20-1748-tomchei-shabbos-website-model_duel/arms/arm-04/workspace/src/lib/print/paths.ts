import type { PrintArtifact } from './documents';

/**
 * Where the paper lives. The board, the batch screen, the order screen and the
 * smoke checks all ask for the same URLs, so the URLs are built in one place
 * rather than typed out four times.
 */
export const FULFILLMENT_PATH = '/admin/fulfillment';
export const BOARD_PATH = `${FULFILLMENT_PATH}/packages`;

export function packagePath(packageId: string): string {
  return `${BOARD_PATH}/${packageId}`;
}

export function batchPath(batchId: string): string {
  return `${FULFILLMENT_PATH}/batches/${batchId}`;
}

export function groupArtifactPath(
  batchId: string,
  groupId: string,
  artifact: PrintArtifact,
): string {
  return `${batchPath(batchId)}/groups/${groupId}/${artifact}`;
}

export function orderArtifactPath(orderId: string, artifact: PrintArtifact): string {
  return `/admin/orders/${orderId}/print/${artifact}`;
}
