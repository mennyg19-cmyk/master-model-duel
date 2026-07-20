export type PackageGroupingInput = {
  recipientName: string;
  addressKey: string;
  fulfillmentMethodCode: string;
  greeting: string;
};

export type GroupableLine = PackageGroupingInput & {
  lineId: string;
  quantity: number;
};

function normalizeGroupingPart(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function createPackageGroupingKey(input: PackageGroupingInput) {
  return JSON.stringify([
    normalizeGroupingPart(input.recipientName),
    normalizeGroupingPart(input.addressKey),
    normalizeGroupingPart(input.fulfillmentMethodCode),
    normalizeGroupingPart(input.greeting),
  ]);
}

export function groupLinesIntoPackages(lines: readonly GroupableLine[]) {
  const groupedLines = new Map<string, GroupableLine[]>();

  for (const line of lines) {
    const groupingKey = createPackageGroupingKey(line);
    groupedLines.set(groupingKey, [...(groupedLines.get(groupingKey) ?? []), line]);
  }

  return [...groupedLines.entries()].map(([groupingKey, packageLines]) => ({
    groupingKey,
    lines: packageLines,
  }));
}
