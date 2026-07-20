const ORDER_DRAFT_STORAGE_PREFIX = "tomchei-order-draft";

export function getOrderDraftStorageKey(ownerKey: string) {
  return `${ORDER_DRAFT_STORAGE_PREFIX}:${ownerKey}`;
}
