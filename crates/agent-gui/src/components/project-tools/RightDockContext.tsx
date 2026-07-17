// Shared context for right-dock tool panels. RightDockPanel assembles one
// memoized value per project scope; registry tool components and
// RightDockContent consume it instead of prop-drilling through the tree.

import { createContext, useContext } from "react";
import type { GitClient } from "../../lib/git/types";
import type {
  RightDockFileTreeState,
  RightDockFileTreeStatePatch,
  SshHostConfig,
} from "../../lib/settings";
import type { TerminalClient, TerminalSession, TerminalSnapshot } from "../../lib/terminal/types";
import type { WorkspaceActivityClient } from "../../lib/workspace-activity/types";
import type { GitCommitContextPayload, GitFileContextPayload } from "./git-review";
import type { LocalTunnelClient } from "./LocalTunnelPanel";

export type RightDockToolClients = {
  terminal: TerminalClient;
  git?: GitClient | null;
  tunnel?: LocalTunnelClient | null;
  workspaceActivity?: WorkspaceActivityClient | null;
};

export type RightDockToolCapabilities = {
  projectReady: boolean;
  terminalReady: boolean;
  disabledMessage?: string;
  terminalDisabledMessage?: string;
  gitWriteEnabled: boolean;
  gitDisabledMessage?: string;
  tunnelEnabled: boolean;
  tunnelDisabledMessage?: string;
  tunnelPublicBaseUrl: string;
};

export type RightDockFileTreeContext = {
  state: RightDockFileTreeState;
  initialized: boolean;
  onInitializedChange: (initialized: boolean) => void;
  onStateChange: (patch: RightDockFileTreeStatePatch) => void;
  onInsertFileMention?: (path: string, kind: "file" | "dir") => void;
  onOpenFile?: (path: string, imagePaths?: string[]) => void;
  onRevealInFileTree: (path: string) => void;
};

export type RightDockGitContext = {
  onInsertCommitMention?: (commit: GitCommitContextPayload) => void;
  onInsertGitFileMention?: (file: GitFileContextPayload) => void;
};

export type RightDockSshContext = {
  hosts: SshHostConfig[];
  associatedHostIds: string[];
  sessions: TerminalSession[];
  onOpenSession?: (session: TerminalSession, kind?: "bash" | "sftp") => void;
  onAssociatedHostIdsChange?: (hostIds: string[]) => void;
  onSessionSnapshot: (snapshot: TerminalSnapshot) => void;
  onSessionClosed: (sessionId: string) => void;
  onSessionsReconcile: (sessions: TerminalSession[]) => void;
};

export type RightDockToolContextValue = {
  projectPathKey: string;
  cwd: string;
  theme: "light" | "dark";
  clients: RightDockToolClients;
  capabilities: RightDockToolCapabilities;
  fileTree: RightDockFileTreeContext;
  git: RightDockGitContext;
  ssh: RightDockSshContext;
  openExternal: (url: string) => void;
};

export const RightDockToolContext = createContext<RightDockToolContextValue | null>(null);

export function useRightDockToolContext(): RightDockToolContextValue {
  const value = useContext(RightDockToolContext);
  if (!value) {
    throw new Error("useRightDockToolContext must be used inside RightDockToolContext.Provider");
  }
  return value;
}
