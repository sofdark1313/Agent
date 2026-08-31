import type { AppSettings } from "../../lib/settings";

export type SetSettingsFn = (updater: (prev: AppSettings) => AppSettings) => void;

export type SectionId =
  | "system"
  | "systemTools"
  | "providers"
  | "agents"
  | "ssh"
  | "memory"
  | "hooks"
  | "remote"
  | "tunnel"
  | "backgroundTasks"
  | "about";

export type WebSettingsSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

export type SettingsPageProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
  saveState: WebSettingsSaveState;
  onBack: () => void;
  initialSection?: SectionId;
  hiddenSections?: SectionId[];
  appUpdate?: any;
};

export type SettingsSectionProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
};
