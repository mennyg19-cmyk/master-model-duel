export const fulfillmentFees = {
  BULK_DELIVERY: 1200,
  PACKAGE_DELIVERY: 800,
  SHIPPING: 1800,
  PICKUP: 0,
} as const;

export type CheckoutLineChoice = {
  orderLineId: string;
  fulfillmentCode: keyof typeof fulfillmentFees;
  greeting: string;
  deliveryDay?: string | null;
};

export class CheckoutConflictError extends Error {
  constructor(
    message: string,
    readonly conflicts: string[],
  ) {
    super(message);
    this.name = "CheckoutConflictError";
  }
}

function getFeeGroup(choice: CheckoutLineChoice, addressId: string) {
  return choice.fulfillmentCode === "PACKAGE_DELIVERY"
    ? `${choice.fulfillmentCode}:${choice.orderLineId}`
    : `${choice.fulfillmentCode}:${addressId}`;
}

export function calculateFulfillmentFees(
  choices: CheckoutLineChoice[],
  addressIdsByLineId: ReadonlyMap<string, string>,
  shippingFeesByAddressId?: ReadonlyMap<string, number>,
) {
  const chargedGroups = new Set<string>();
  const feesByLineId = new Map<string, number>();
  for (const choice of choices) {
    const addressId = addressIdsByLineId.get(choice.orderLineId);
    if (!addressId) {
      throw new CheckoutConflictError("Every gift needs a recipient before checkout.", [
        "Choose a recipient for every cart line.",
      ]);
    }
    const group = getFeeGroup(choice, addressId);
    const configuredFee =
      choice.fulfillmentCode === "SHIPPING"
        ? shippingFeesByAddressId
          ? shippingFeesByAddressId.get(addressId)
          : fulfillmentFees.SHIPPING
        : fulfillmentFees[choice.fulfillmentCode];
    if (configuredFee === undefined) {
      throw new CheckoutConflictError("Live shipping is unavailable for this recipient.", [
        "Refresh rates or choose another fulfillment method.",
      ]);
    }
    const fee = chargedGroups.has(group) ? 0 : configuredFee;
    chargedGroups.add(group);
    feesByLineId.set(choice.orderLineId, fee);
  }
  return feesByLineId;
}
