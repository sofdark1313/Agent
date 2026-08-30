import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "../i18n";
import { dispatchAppCommand } from "../lib/appCommands";
import { cn } from "../lib/shared/utils";
import type { SectionId } from "../pages/settings/types";
import { AgentMark } from "./brand/AgentMark";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

type TauriRuntimeWindow = Window & {
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
};

type AppWindow = ReturnType<typeof getCurrentWindow>;
type EditCommand = "undo" | "redo" | "cut" | "copy" | "paste" | "delete" | "selectAll";

const TITLE_BAR_MENU_ITEM_CLASS =
  "rounded-lg px-3 py-2 text-[13px] leading-5 focus:bg-foreground/[0.065]";

function resolveEditableTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) {
    return null;
  }
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.disabled || target.readOnly ? null : target;
  }
  if (target.isContentEditable) {
    return target;
  }
  const editableParent = target.closest<HTMLElement>('[contenteditable="true"]');
  return editableParent?.isContentEditable ? editableParent : null;
}

function isWindowsTauriRuntime() {
  if (typeof window === "undefined") {
    return false;
  }

  const runtimeWindow = window as TauriRuntimeWindow;
  const hasTauriRuntime =
    runtimeWindow.__TAURI__ !== undefined || runtimeWindow.__TAURI_INTERNALS__ !== undefined;
  const platformText = `${navigator.userAgent} ${navigator.platform}`;
  return hasTauriRuntime && /\bWindows\b|Win32|Win64|WOW64/i.test(platformText);
}

function reportWindowChromeError(action: string, error: unknown) {
  console.error(`failed to ${action} Agent window`, error);
}

function MenuShortcut({ children }: { children: ReactNode }) {
  return <span className="ml-auto pl-8 text-[12px] text-muted-foreground/70">{children}</span>;
}

function TitleBarMenu(props: {
  id: "file" | "edit" | "view" | "help";
  label: string;
  children: ReactNode;
  contentClassName?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-agent-window-menu={props.id}
            className="h-6 rounded px-2 text-[12px] text-foreground/70 transition-colors hover:bg-foreground/[0.06] hover:text-foreground data-[popup-open]:bg-foreground/[0.08]"
          />
        }
      >
        {props.label}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={3}
        className={cn(
          "min-w-52 rounded-xl border-border/70 bg-popover/98 p-1.5 shadow-[var(--agent-shadow-menu)]",
          props.contentClassName,
        )}
      >
        {props.children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WindowsTitleBar(props: {
  onOpenSettings?: (section?: SectionId) => void;
  onToggleTheme?: () => void;
}) {
  const { t } = useLocale();
  const [isVisible, setIsVisible] = useState(() => isWindowsTauriRuntime());
  const [isMaximized, setIsMaximized] = useState(false);
  const [isFocused, setIsFocused] = useState(true);
  const appWindowRef = useRef<AppWindow | null>(null);
  const lastEditableTargetRef = useRef<HTMLElement | null>(null);

  const getAppWindow = useCallback(() => {
    if (!appWindowRef.current) {
      appWindowRef.current = getCurrentWindow();
    }
    return appWindowRef.current;
  }, []);

  const closeWindow = useCallback(() => {
    void getAppWindow()
      .close()
      .catch((error) => reportWindowChromeError("close", error));
  }, [getAppWindow]);

  const openNewWindow = useCallback(() => {
    const label = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const nextWindow = new WebviewWindow(label, {
      url: "/",
      title: "Agent",
      width: 1400,
      height: 800,
      minWidth: 1200,
      minHeight: 720,
      center: true,
      decorations: false,
    });
    void nextWindow.once("tauri://error", ({ payload }) => {
      reportWindowChromeError("create", payload);
    });
  }, []);

  const runEditCommand = useCallback((command: EditCommand) => {
    const target = lastEditableTargetRef.current;
    window.setTimeout(() => {
      if (!target?.isConnected) {
        return;
      }
      target.focus({ preventScroll: true });

      if (command === "paste") {
        const fallbackPaste = () => document.execCommand("paste");
        if (!navigator.clipboard?.readText) {
          fallbackPaste();
          return;
        }
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
              const start = target.selectionStart ?? target.value.length;
              const end = target.selectionEnd ?? start;
              target.setRangeText(text, start, end, "end");
              target.dispatchEvent(
                new InputEvent("input", {
                  bubbles: true,
                  data: text,
                  inputType: "insertFromPaste",
                }),
              );
              return;
            }
            document.execCommand("insertText", false, text);
          })
          .catch(fallbackPaste);
        return;
      }

      document.execCommand(command);
    }, 0);
  }, []);

  const syncMaximized = useCallback(() => {
    if (!isVisible) {
      return;
    }
    void getAppWindow()
      .isMaximized()
      .then(setIsMaximized)
      .catch((error) => reportWindowChromeError("read maximized state for", error));
  }, [getAppWindow, isVisible]);

  useEffect(() => {
    setIsVisible(isWindowsTauriRuntime());
  }, []);

  useEffect(() => {
    if (!isVisible) return undefined;
    const handleFocusIn = (event: FocusEvent) => {
      const editableTarget = resolveEditableTarget(event.target);
      if (editableTarget) {
        lastEditableTargetRef.current = editableTarget;
      }
    };
    document.addEventListener("focusin", handleFocusIn);
    return () => document.removeEventListener("focusin", handleFocusIn);
  }, [isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return undefined;
    }

    const appWindow = getAppWindow();
    let disposed = false;
    let unlistenResize: (() => void) | undefined;
    let unlistenFocus: (() => void) | undefined;

    void appWindow
      .isMaximized()
      .then((maximized) => {
        if (!disposed) {
          setIsMaximized(maximized);
        }
      })
      .catch((error) => reportWindowChromeError("read maximized state for", error));

    void appWindow
      .isFocused()
      .then((focused) => {
        if (!disposed) {
          setIsFocused(focused);
        }
      })
      .catch((error) => reportWindowChromeError("read focus state for", error));

    void appWindow
      .onResized(() => {
        if (!disposed) {
          syncMaximized();
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenResize = unlisten;
        }
      })
      .catch((error) => reportWindowChromeError("subscribe resize events for", error));

    void appWindow
      .onFocusChanged(({ payload }) => {
        if (!disposed) {
          setIsFocused(payload);
        }
      })
      .then((unlisten) => {
        if (disposed) {
          unlisten();
        } else {
          unlistenFocus = unlisten;
        }
      })
      .catch((error) => reportWindowChromeError("subscribe focus events for", error));

    return () => {
      disposed = true;
      unlistenResize?.();
      unlistenFocus?.();
    };
  }, [getAppWindow, isVisible, syncMaximized]);

  useEffect(() => {
    if (!isVisible) return undefined;

    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();

      if (event.altKey) {
        if (key === "o" && !event.shiftKey) {
          event.preventDefault();
          dispatchAppCommand("newProjectlessChat");
        }
        return;
      }

      if (key === "n" && event.shiftKey) {
        event.preventDefault();
        openNewWindow();
      } else if (key === "n") {
        event.preventDefault();
        dispatchAppCommand("newChat");
      } else if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        dispatchAppCommand("openFolder");
      } else if (key === "w" && !event.shiftKey) {
        event.preventDefault();
        closeWindow();
      } else if (key === "," && !event.shiftKey) {
        event.preventDefault();
        props.onOpenSettings?.();
      } else if (key === "l" && !event.shiftKey) {
        event.preventDefault();
        dispatchAppCommand("focusComposer");
      } else if (key === "b" && event.shiftKey) {
        event.preventDefault();
        dispatchAppCommand("toggleProjectTools");
      } else if (key === "b") {
        event.preventDefault();
        dispatchAppCommand("toggleSidebar");
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [closeWindow, isVisible, openNewWindow, props.onOpenSettings]);

  const startDragging = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0 || event.detail !== 1) {
        return;
      }
      void getAppWindow()
        .startDragging()
        .catch((error) => reportWindowChromeError("drag", error));
    },
    [getAppWindow],
  );

  const toggleMaximize = useCallback(() => {
    const appWindow = getAppWindow();
    void appWindow
      .toggleMaximize()
      .then(() => appWindow.isMaximized())
      .then(setIsMaximized)
      .catch((error) => reportWindowChromeError("toggle maximized state for", error));
  }, [getAppWindow]);

  const handleTitleDoubleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return;
      }
      toggleMaximize();
    },
    [toggleMaximize],
  );

  const minimizeWindow = useCallback(() => {
    void getAppWindow()
      .minimize()
      .catch((error) => reportWindowChromeError("minimize", error));
  }, [getAppWindow]);

  if (!isVisible) {
    return null;
  }

  const maximizeLabel = isMaximized ? t("window.restore") : t("window.maximize");

  return (
    <header
      className={cn(
        "relative z-50 flex h-8 shrink-0 select-none items-center border-b border-black/[0.06] bg-white/65 text-foreground/90 backdrop-blur-2xl backdrop-saturate-150 supports-[backdrop-filter]:bg-white/55 dark:border-white/[0.06] dark:bg-neutral-900/70 dark:supports-[backdrop-filter]:bg-neutral-900/55",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
        !isFocused && "text-foreground/55",
      )}
    >
      <div
        role="toolbar"
        aria-label={t("app.name")}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-3"
      >
        <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[4px] bg-foreground text-background">
          <AgentMark className="h-[12px] w-[12px]" />
        </span>
        <span className="truncate text-[12px] font-medium leading-[1.45] tracking-[0.01em] text-foreground/80">
          {t("app.name")}
        </span>
        <div data-agent-window-menu-region className="ml-1 flex h-full items-center gap-0.5">
          <TitleBarMenu id="file" label={t("window.menu.file")} contentClassName="min-w-[270px]">
            <DropdownMenuItem onSelect={openNewWindow} className={TITLE_BAR_MENU_ITEM_CLASS}>
              {t("window.menu.newWindow")}
              <MenuShortcut>Ctrl+Shift+N</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("newChat")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.newTask")}
              <MenuShortcut>Ctrl+N</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("newProjectlessChat")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.newProjectlessTask")}
              <MenuShortcut>Alt+Ctrl+O</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("openFolder")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.openFolder")}
              <MenuShortcut>Ctrl+O</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem onSelect={closeWindow} className={TITLE_BAR_MENU_ITEM_CLASS}>
              {t("window.menu.close")}
              <MenuShortcut>Ctrl+W</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              disabled={!props.onOpenSettings}
              onSelect={() => props.onOpenSettings?.()}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.settings")}
              <MenuShortcut>Ctrl+,</MenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>

          <TitleBarMenu id="edit" label={t("window.menu.edit")} contentClassName="min-w-[210px]">
            <DropdownMenuItem
              onSelect={() => runEditCommand("undo")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.undo")}
              <MenuShortcut>Ctrl+Z</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runEditCommand("redo")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.redo")}
              <MenuShortcut>Ctrl+Y</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              onSelect={() => runEditCommand("cut")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.cut")}
              <MenuShortcut>Ctrl+X</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runEditCommand("copy")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.copy")}
              <MenuShortcut>Ctrl+C</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runEditCommand("paste")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.paste")}
              <MenuShortcut>Ctrl+V</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => runEditCommand("delete")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.delete")}
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              onSelect={() => runEditCommand("selectAll")}
              className={TITLE_BAR_MENU_ITEM_CLASS}
            >
              {t("window.menu.selectAll")}
              <MenuShortcut>Ctrl+A</MenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>

          <TitleBarMenu id="view" label={t("window.menu.view")}>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("toggleSidebar")}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.toggleSidebar")}
              <MenuShortcut>Ctrl+B</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("toggleProjectTools")}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.toggleProjectTools")}
              <MenuShortcut>Ctrl+Shift+B</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              disabled={!props.onToggleTheme}
              onSelect={() => props.onToggleTheme?.()}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.appearance")}
            </DropdownMenuItem>
          </TitleBarMenu>

          <TitleBarMenu id="help" label={t("window.menu.help")}>
            <DropdownMenuItem
              disabled={!props.onOpenSettings}
              onSelect={() => props.onOpenSettings?.("about")}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.about")}
            </DropdownMenuItem>
          </TitleBarMenu>
        </div>
        <button
          type="button"
          data-agent-window-drag-region
          tabIndex={-1}
          aria-label={t("app.name")}
          className="h-full min-w-6 flex-1 cursor-default"
          onDoubleClick={handleTitleDoubleClick}
          onMouseDown={startDragging}
        />
      </div>

      <fieldset
        className="m-0 flex h-full shrink-0 items-stretch border-0 p-0"
        aria-label={t("window.controls")}
      >
        <button
          type="button"
          className="group flex h-full w-[46px] items-center justify-center text-foreground/60 transition-colors duration-150 hover:bg-black/[0.08] hover:text-foreground focus-visible:outline-hidden focus-visible:bg-black/[0.08] focus-visible:text-foreground dark:hover:bg-white/[0.10] dark:focus-visible:bg-white/[0.10]"
          aria-label={t("window.minimize")}
          title={t("window.minimize")}
          onClick={minimizeWindow}
        >
          <span className="text-[13px] font-light leading-none select-none">─</span>
        </button>
        <button
          type="button"
          className="group flex h-full w-[46px] items-center justify-center text-foreground/60 transition-colors duration-150 hover:bg-black/[0.08] hover:text-foreground focus-visible:outline-hidden focus-visible:bg-black/[0.08] focus-visible:text-foreground dark:hover:bg-white/[0.10] dark:focus-visible:bg-white/[0.10]"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={toggleMaximize}
        >
          {isMaximized ? (
            <span className="text-[18px] font-light leading-none select-none">⧉</span>
          ) : (
            <span className="text-[18px] font-light leading-none select-none">□</span>
          )}
        </button>
        <button
          type="button"
          className="group flex h-full w-[46px] items-center justify-center text-foreground/60 transition-colors duration-150 hover:bg-[#e81123] hover:text-white focus-visible:outline-hidden focus-visible:bg-[#e81123] focus-visible:text-white"
          aria-label={t("window.close")}
          title={t("window.close")}
          onClick={closeWindow}
        >
          <span className="text-[14px] font-light leading-none select-none">✕</span>
        </button>
      </fieldset>
    </header>
  );
}
