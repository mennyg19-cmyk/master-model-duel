/** Admin chrome / ops settings (P6). */
export const OPS_SETTINGS = {
  alertBanner: "admin.alertBanner",
} as const;

export type AlertBannerSetting = {
  message: string;
  tone?: "info" | "warn";
  active?: boolean;
};
