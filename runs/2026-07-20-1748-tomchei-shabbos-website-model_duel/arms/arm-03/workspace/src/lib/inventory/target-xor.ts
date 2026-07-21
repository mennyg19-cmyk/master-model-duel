/** App-level mirror of DB CHECK InventoryItem_target_xor_check. */
export function assertInventoryTargetXor(input: {
  productId?: string | null;
  addOnId?: string | null;
}): void {
  const hasProduct = input.productId != null && input.productId.length > 0;
  const hasAddOn = input.addOnId != null && input.addOnId.length > 0;
  if (hasProduct === hasAddOn) {
    throw new Error(
      "InventoryItem XOR violated: exactly one of productId or addOnId is required",
    );
  }
}
