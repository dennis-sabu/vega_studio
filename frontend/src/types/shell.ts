export type WorkspaceMode = "home" | "workspace";

export type PrimaryNavSection =
  | "explorer"
  | "git"
  | "examples"
  | "sdk"
  | "tools";

export type BottomPanelTab =
  | "build"
  | "terminal"
  | "serial"
  | "diagnostics"
  | "upload"
  | "logs";

export type RightPanelTab = "native-ai" | "opencode";

export type CenterTabId = "overview" | "diagnostics";

export interface ShellLayoutState {
  activeMode: WorkspaceMode;
  activeNav: PrimaryNavSection;
  sidebarOpen: boolean;
  sidebarWidth: number;
  bottomPanelOpen: boolean;
  bottomPanelHeight: number;
  bottomPanelMaximized: boolean;
  activeBottomTab: BottomPanelTab;
  rightPanelOpen: boolean;
  rightPanelWidth: number;
  activeRightTab: RightPanelTab;
  openCenterTabs: CenterTabId[];
  activeCenterTab: CenterTabId | null;
}

export interface ShellLogEntry {
  id: string;
  timestamp: string;
  category: "SHELL" | "BACKEND" | "LAYOUT";
  level: "info" | "warn" | "error";
  message: string;
}
