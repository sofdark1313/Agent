import { getCurrentWindow } from "@tauri-apps/api/window";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";

import { useLocale } from "../i18n";
import { dispatchAppCommand } from "../lib/appCommands";
import { cn } from "../lib/shared/utils";
import type { SectionId } from "../pages/settings/types";
import { AgentMark } from "./brand/AgentMark";
import { Maximize2, Minimize2, Minus, X } from "./icons";
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
  return <span className="ml-auto pl-6 text-[11px] text-muted-foreground/65">{children}</span>;
}

function TitleBarMenu(props: {
  id: "file" | "edit" | "view" | "help";
  label: string;
  children: ReactNode;
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
        className="min-w-52 rounded-lg border-border/70 bg-popover/98 p-1 shadow-[var(--agent-shadow-menu)]"
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

  const getAppWindow = useCallback(() => {
    if (!appWindowRef.current) {
      appWindowRef.current = getCurrentWindow();
    }
    return appWindowRef.current;
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
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      const key = event.key.toLowerCase();

      if (key === "n" && !event.shiftKey) {
        event.preventDefault();
        dispatchAppCommand("newChat");
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
  }, [isVisible, props.onOpenSettings]);

  const startDragging = useCallback(
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) {
        return;
      }
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
    (event: MouseEvent<HTMLDivElement>) => {
      if (event.target instanceof HTMLElement && event.target.closest("button")) {
        return;
      }
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

  const closeWindow = useCallback(() => {
    void getAppWindow()
      .close()
      .catch((error) => reportWindowChromeError("close", error));
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
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2.5 pr-3"
        onDoubleClick={handleTitleDoubleClick}
        onMouseDown={startDragging}
      >
        <span className="flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[4px] bg-foreground text-background">
          <AgentMark className="h-[12px] w-[12px]" />
        </span>
        <span className="truncate text-[12px] font-medium leading-[1.45] tracking-[0.01em] text-foreground/80">
          {t("app.name")}
        </span>
        <div className="ml-1 flex h-full items-center gap-0.5">
          <TitleBarMenu id="file" label={t("window.menu.file")}>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("newChat")}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.newChat")}
              <MenuShortcut>Ctrl+N</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem
              disabled={!props.onOpenSettings}
              onSelect={() => props.onOpenSettings?.()}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.settings")}
              <MenuShortcut>Ctrl+,</MenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="my-1 bg-border/60" />
            <DropdownMenuItem onSelect={closeWindow} className="rounded-md px-2 py-1.5 text-xs">
              {t("window.menu.exit")}
              <MenuShortcut>Alt+F4</MenuShortcut>
            </DropdownMenuItem>
          </TitleBarMenu>

          <TitleBarMenu id="edit" label={t("window.menu.edit")}>
            <DropdownMenuItem
              onSelect={() => dispatchAppCommand("focusComposer")}
              className="rounded-md px-2 py-1.5 text-xs"
            >
              {t("window.menu.focusComposer")}
              <MenuShortcut>Ctrl+L</MenuShortcut>
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
      </div>

      <fieldset
        className="m-0 flex h-full shrink-0 items-stretch border-0 p-0"
        aria-label={t("window.controls")}
      >
        <button
          type="button"
          className="group flex h-full w-[38px] items-center justify-center text-foreground/55 transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground/90 focus-visible:outline-hidden focus-visible:bg-black/[0.05] focus-visible:text-foreground/90 dark:hover:bg-white/[0.07] dark:focus-visible:bg-white/[0.07]"
          aria-label={t("window.minimize")}
          title={t("window.minimize")}
          onClick={minimizeWindow}
        >
          <Minus className="h-[13px] w-[13px]" strokeWidth={1.4} />
        </button>
        <button
          type="button"
          className="group flex h-full w-[38px] items-center justify-center text-foreground/55 transition-colors duration-150 hover:bg-black/[0.05] hover:text-foreground/90 focus-visible:outline-hidden focus-visible:bg-black/[0.05] focus-visible:text-foreground/90 dark:hover:bg-white/[0.07] dark:focus-visible:bg-white/[0.07]"
          aria-label={maximizeLabel}
          title={maximizeLabel}
          onClick={toggleMaximize}
        >
          {isMaximized ? (
            <Minimize2 className="h-[12px] w-[12px]" strokeWidth={1.4} />
          ) : (
            <Maximize2 className="h-[12px] w-[12px]" strokeWidth={1.4} />
          )}
        </button>
        <button
          type="button"
          className="group flex h-full w-[42px] items-center justify-center text-foreground/55 transition-colors duration-150 hover:bg-[#e81123] hover:text-white focus-visible:outline-hidden focus-visible:bg-[#e81123] focus-visible:text-white"
          aria-label={t("window.close")}
          title={t("window.close")}
          onClick={closeWindow}
        >
          <X className="h-[13px] w-[13px]" strokeWidth={1.5} />
        </button>
      </fieldset>
    </header>
  );
}
