// The "group by customer, notify once" law (m18): day-of delivery and bulk
// scheduling both collapse a flat item list into one notification per
// distinct customer, even when a customer's packages span multiple orders.

export interface CustomerNotificationGroup<T, C> {
  customer: C;
  orderIds: Set<string>;
  recipients: string[];
  items: T[];
}

export function groupByCustomer<T, C>(
  items: T[],
  customerKey: (item: T) => string,
  customer: (item: T) => C,
  recipientName: (item: T) => string,
  orderId: (item: T) => string,
): Map<string, CustomerNotificationGroup<T, C>> {
  const groups = new Map<string, CustomerNotificationGroup<T, C>>();
  for (const item of items) {
    const key = customerKey(item);
    const entry = groups.get(key) ?? { customer: customer(item), orderIds: new Set<string>(), recipients: [], items: [] };
    entry.orderIds.add(orderId(item));
    entry.recipients.push(recipientName(item));
    entry.items.push(item);
    groups.set(key, entry);
  }
  return groups;
}
