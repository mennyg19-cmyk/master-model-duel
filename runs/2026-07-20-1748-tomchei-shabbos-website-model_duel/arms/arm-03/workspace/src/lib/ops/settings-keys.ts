/** Admin chrome / ops settings (P6 / P12). */
export const OPS_SETTINGS = {
  alertBanner: "admin.alertBanner",
  testMode: "ops.testMode",
} as const;

export type AlertBannerSetting = {
  message: string;
  tone?: "info" | "warn";
  active?: boolean;
};

export type TestModeSetting = {
  enabled: boolean;
  env: "test" | "live";
};
