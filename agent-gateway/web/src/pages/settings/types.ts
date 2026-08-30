
import type { AppSettings } from "@/lib/settings";

export type SettingsSaveState = {
  status: "idle" | "saving" | "saved" | "error";
  message?: string;
};

export type AppUpdateController = any;
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
  | "about";

export type SettingsPageProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
  saveState: SettingsSaveState;
  onBack: () => void;
  initialSection?: SectionId;
  hiddenSections?: SectionId[];
  appUpdate?: AppUpdateController;
};

export type SettingsSectionProps = {
  settings: AppSettings;
  setSettings: SetSettingsFn;
  appUpdate?: AppUpdateController;
  saveIndicator?: { title: string; dotClass: string; text: string };
  onOpenSkillsHub?: () => void;
  onOpenMcpHub?: () => void;
};
