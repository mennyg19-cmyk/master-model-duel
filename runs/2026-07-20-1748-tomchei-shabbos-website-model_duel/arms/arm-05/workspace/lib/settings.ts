type SettingMap = {
  organizationName: string;
  supportEmail: string;
  seasonTimezone: string;
};

const settings: SettingMap = {
  organizationName: "Tomchei Shabbos",
  supportEmail: "help@example.test",
  seasonTimezone: "America/New_York",
};

export function getSetting<Key extends keyof SettingMap>(key: Key) {
  return settings[key];
}

export function setSetting<Key extends keyof SettingMap>(key: Key, value: SettingMap[Key]) {
  settings[key] = value;
}
