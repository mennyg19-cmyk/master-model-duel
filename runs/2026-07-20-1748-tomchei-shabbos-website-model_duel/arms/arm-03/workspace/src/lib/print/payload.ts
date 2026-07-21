export type PrintItem = { name: string; quantity: number; addOns: string[] };

export type PrintPackage = {
  packageId: string;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string;
  zip: string;
  methodName: string;
  greeting: string;
  stage: string;
  orderRefs: string[];
  items: PrintItem[];
};

export type GroupArtifactPayload = {
  filingGroup: string;
  generatedAt: string;
  packages: PrintPackage[];
};

export type PackingSlipPayload = {
  orderRef: string;
  customerName: string;
  generatedAt: string;
  packages: PrintPackage[];
};
