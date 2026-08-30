// Memoized virtual-list rows for the right-dock file tree panel.
//
// MIRROR NOTICE: every file under components/project-tools/file-tree/ exists
// byte-for-byte in both frontends (agent-gui/src and
// agent-gateway/web/src). Keep changes in sync on both ends; only
// relative, npm-package, or @tauri-apps/* imports are allowed here.

import { memo, type MouseEvent as ReactMouseEvent } from "react";
import { useLocale } from "../../../i18n";
import { cn } from "../../../lib/shared/utils";
import { getFileTypeIcon } from "../../chat/fileTypeIcons";
import { ChevronRight, Loader2 } from "../../icons";
import { FILE_TREE_ROW_HEIGHT, type FileTreeKind } from "./model";

export type FileTreeRowProps = {
  path: string;
  name: string;
  kind: FileTreeKind;
  depth: number;
  expanded: boolean;
  selected: boolean;
  loading: boolean;
  title: string;
  // All callbacks are identity-stable in the panel so memoization holds and
  // an unchanged row never re-renders.
  onToggle: (path: string, expanded: boolean) => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
  onContextMenu: (event: ReactMouseEvent, path: string) => void;
};

export const FileTreeRow = memo(function FileTreeRow(props: FileTreeRowProps) {
  const {
    path,
    name,
    kind,
    depth,
    expanded,
    selected,
    loading,
    title,
    onToggle,
    onSelect,
    onOpen,
    onContextMenu,
  } = props;
  const { t } = useLocale();
  const TypeIcon = getFileTypeIcon(path, kind, { expanded });

  return (
    <div
      role="treeitem"
      aria-selected={selected}
      aria-expanded={kind === "dir" ? expanded : undefined}
      tabIndex={-1}
      className={cn(
        "group flex select-none items-center gap-1.5 rounded-md px-1.5 text-xs leading-5 text-muted-foreground/80 transition-colors hover:bg-muted/40 hover:text-foreground",
        selected && "bg-muted/80 text-foreground font-medium dark:bg-white/[0.08]",
      )}
      style={{ height: FILE_TREE_ROW_HEIGHT, paddingLeft: 6 + depth * 14 }}
      onContextMenu={(event) => onContextMenu(event, path)}
    >
      {kind === "dir" ? (
        <button
          type="button"
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={() => onToggle(path, expanded)}
          title={expanded ? t("projectTools.fileTree.collapse") : t("projectTools.fileTree.expand")}
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : (
            <ChevronRight
              className={cn("h-3.5 w-3.5 transition-transform duration-150", expanded && "rotate-90 text-foreground")}
            />
          )}
        </button>
      ) : (
        <div className="flex h-4 w-4 shrink-0 items-center justify-center">
          <TypeIcon className="h-3.5 w-3.5 shrink-0" />
        </div>
      )}
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center bg-transparent p-0 text-left text-inherit leading-5"
        title={title}
        onClick={() => (kind === "dir" ? onToggle(path, expanded) : onSelect(path))}
        onDoubleClick={() => {
          if (kind === "dir") {
            onToggle(path, expanded);
            return;
          }
          onOpen(path);
        }}
      >
        <span className="min-w-0 truncate">{name}</span>
      </button>
    </div>
  );
});

export type FileTreeErrorRowProps = {
  depth: number;
  message: string;
};

// Per-directory error/notice line rendered as its own (measured) virtual row.
export const FileTreeErrorRow = memo(function FileTreeErrorRow(props: FileTreeErrorRowProps) {
  const { depth, message } = props;
  return (
    <div
      className="break-all px-3 py-1 text-[calc(11px*var(--zone-font-scale,1))] text-amber-600"
      style={{ paddingLeft: 12 + depth * 14 }}
    >
      {message}
    </div>
  );
});
