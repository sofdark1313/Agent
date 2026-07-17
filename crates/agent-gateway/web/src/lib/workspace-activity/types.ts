// Workspace activity invalidation types.
//
// MIRROR NOTICE: this file exists byte-for-byte in both frontends
// (crates/agent-gui/src/lib/workspace-activity/ and
// crates/agent-gateway/web/src/lib/workspace-activity/). Keep changes in sync
// on both ends; only relative or @tauri-apps/* imports are allowed here.

export type WorkspaceActivity = {
  workdir: string;
  revision: number;
  fs: boolean;
  git: boolean;
  changedPaths: string[];
  truncated: boolean;
};

// `{ kind: "reset" }` marks a continuity break (reconnect / resubscribe):
// events may have been missed, so consumers must treat everything as dirty.
export type WorkspaceActivityEventPayload = WorkspaceActivity | { kind: "reset" };

export type WorkspaceActivityClient = {
  subscribe(workdir: string, listener: (ev: WorkspaceActivityEventPayload) => void): () => void;
};
