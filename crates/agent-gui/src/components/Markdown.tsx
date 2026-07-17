import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { openUrl } from "@tauri-apps/plugin-opener";
import { type ComponentProps, memo, useLayoutEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import remarkBreaks from "remark-breaks";
import {
  type Components,
  defaultRehypePlugins,
  defaultRemarkPlugins,
  type ExtraProps,
  type LinkSafetyModalProps,
  Streamdown,
  type StreamdownTranslations,
} from "streamdown";
import { cn } from "../lib/shared/utils";
import { Copy, ExternalLink, X } from "./icons";
import { Button } from "./ui/button";

type MarkdownProps = {
  content: string;
  className?: string;
  // Fixed render mode: content born from a live stream renders in Streamdown
  // streaming mode forever; history-born content renders static. The mode of
  // a given block never flips, so the streaming→static re-render (and its
  // full re-parse) cannot happen. Shiki themes are always active, so code
  // highlights identically in both modes and nothing re-highlights at settle.
  renderMode?: "streaming" | "static";
  // Caret visibility while tokens are arriving. Toggled via a className so
  // the flip never invalidates Streamdown's memoized blocks; the caret slot
  // itself stays mounted for the whole life of a streaming-mode block.
  showCaret?: boolean;
  readOnly?: boolean;
  // Extra component overrides merged over the built-in map. Used by the
  // workspace file preview to render images and links against workspace
  // files instead of the chat text fallbacks.
  componentOverrides?: Components;
  // Skip the harden rehype stage, which rewrites relative image/link URLs
  // against the page origin before they reach custom components. Sanitize
  // still runs, so scriptable protocols (javascript: etc.) never get through.
  preserveRelativeUrls?: boolean;
};

const streamdownPlugins = { code, math, mermaid, cjk };
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks];

type StreamdownRehypePlugins = NonNullable<ComponentProps<typeof Streamdown>["rehypePlugins"]>;

// raw + sanitize from the default chain (raw → sanitize → harden), with data:
// image sources additionally allowed so embedded data-URI images render.
const relativeUrlRehypePlugins = (() => {
  const sanitize = defaultRehypePlugins.sanitize;
  if (!Array.isArray(sanitize)) {
    return [defaultRehypePlugins.raw, sanitize] as StreamdownRehypePlugins;
  }
  const schema = (sanitize[1] ?? {}) as { protocols?: Record<string, unknown[]> };
  const srcProtocols = schema.protocols?.src;
  const protocols = {
    ...schema.protocols,
    src: Array.isArray(srcProtocols)
      ? [...new Set([...srcProtocols, "data"])]
      : ["http", "https", "data"],
  };
  return [
    defaultRehypePlugins.raw,
    [sanitize[0], { ...schema, protocols }],
  ] as StreamdownRehypePlugins;
})();

type MarkdownImageFallbackProps = ComponentProps<"img"> & ExtraProps;
type MarkdownAnchorFallbackProps = ComponentProps<"a"> & ExtraProps;

function MarkdownImageFallback(props: MarkdownImageFallbackProps) {
  const { alt, title } = props;
  const label =
    typeof alt === "string" && alt.trim()
      ? alt.trim()
      : typeof title === "string" && title.trim()
        ? title.trim()
        : "";
  if (!label) return null;
  return (
    <span
      className="text-xs italic text-muted-foreground"
      data-liveagent-markdown-image="text-fallback"
      title={label}
    >
      {label}
    </span>
  );
}

export const markdownComponents: Components = {
  img: MarkdownImageFallback,
};

function MarkdownReadOnlyLink(props: MarkdownAnchorFallbackProps) {
  const { children, href, title } = props;
  const label =
    typeof title === "string" && title.trim()
      ? title.trim()
      : typeof href === "string" && href.trim()
        ? href.trim()
        : undefined;
  return (
    <span className="text-primary underline decoration-primary/35 underline-offset-4" title={label}>
      {children}
    </span>
  );
}

export const markdownReadOnlyComponents: Components = {
  ...markdownComponents,
  a: MarkdownReadOnlyLink,
};

const codeBlockSelector = '[data-streamdown="code-block"]';
const codeCopyButtonSelector =
  '[data-streamdown="code-block"] [data-streamdown="code-block-copy-button"]';
const codeBlockBodySelector = '[data-streamdown="code-block-body"] pre';

function enableCodeCopyButtons(root: HTMLElement) {
  root.querySelectorAll<HTMLButtonElement>(codeCopyButtonSelector).forEach((button) => {
    if (!button.disabled && !button.hasAttribute("disabled")) return;
    button.disabled = false;
    button.removeAttribute("disabled");
  });
}

function getCodeBlockText(button: HTMLButtonElement) {
  const codeBlock = button.closest(codeBlockSelector);
  const codeBody = codeBlock?.querySelector<HTMLElement>(codeBlockBodySelector);
  return codeBody?.textContent ?? null;
}

async function copyCodeBlockText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    console.error("Failed to copy code block", error);
  }
}

function useEnabledCodeCopyButtons(enabled: boolean) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (!enabled) return;

    const root = rootRef.current;
    if (!root) return;

    // Streamdown disables copy controls while animating, but the copy handler
    // can safely copy the current partial code during streaming.
    enableCodeCopyButtons(root);

    const handleCopyClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;

      const button = target.closest(codeCopyButtonSelector);
      if (!(button instanceof HTMLButtonElement) || !root.contains(button)) return;

      const codeText = getCodeBlockText(button);
      if (codeText === null) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void copyCodeBlockText(codeText);
    };

    root.addEventListener("click", handleCopyClick, true);

    let observer: MutationObserver | undefined;
    if (typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        enableCodeCopyButtons(root);
      });
      observer.observe(root, {
        attributes: true,
        attributeFilter: ["disabled"],
        childList: true,
        subtree: true,
      });
    }

    return () => {
      root.removeEventListener("click", handleCopyClick, true);
      observer?.disconnect();
    };
  }, [enabled]);

  return rootRef;
}

const streamdownTranslations = {
  close: "关闭",
  copied: "已复制",
  copyCode: "复制代码",
  copyLink: "复制链接",
  copyTable: "复制表格",
  copyTableAsCsv: "复制为 CSV",
  copyTableAsMarkdown: "复制为 Markdown",
  copyTableAsTsv: "复制为 TSV",
  downloadDiagram: "下载图表",
  downloadDiagramAsMmd: "下载为 Mermaid",
  downloadDiagramAsPng: "下载为 PNG",
  downloadDiagramAsSvg: "下载为 SVG",
  downloadFile: "下载文件",
  downloadImage: "下载图片",
  downloadTable: "下载表格",
  downloadTableAsCsv: "下载为 CSV",
  downloadTableAsMarkdown: "下载为 Markdown",
  exitFullscreen: "退出全屏",
  externalLinkWarning: "即将打开外部链接，请确认目标站点可信。",
  imageNotAvailable: "图片暂不可用",
  mermaidFormatMmd: "Mermaid 源码",
  mermaidFormatPng: "PNG 图片",
  mermaidFormatSvg: "SVG 图片",
  openExternalLink: "打开外部链接",
  openLink: "打开链接",
  tableFormatCsv: "CSV",
  tableFormatMarkdown: "Markdown",
  tableFormatTsv: "TSV",
  viewFullscreen: "全屏查看",
} satisfies Partial<StreamdownTranslations>;

export function ExternalLinkModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch (error) {
      console.error("Failed to copy external link", error);
    }
  };

  const handleOpenLink = async () => {
    try {
      await openUrl(url);
    } catch (error) {
      console.error("Failed to open external link via opener", error);
      onConfirm();
    } finally {
      onClose();
    }
  };

  const modal = (
    <div
      className="external-link-modal-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/18 px-4 py-6 backdrop-blur-sm"
      data-state="open"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="external-link-modal-panel w-full max-w-[34rem] rounded-[22px] border border-border/70 bg-background/98 shadow-[0_24px_80px_-28px_rgba(15,23,42,0.38)]"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={streamdownTranslations.openExternalLink}
      >
        <div className="flex items-start justify-between gap-4 px-8 pb-4 pt-7">
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[1.65rem] font-semibold tracking-[-0.02em] text-foreground">
              <ExternalLink className="size-5" />
              <span>{streamdownTranslations.openExternalLink}</span>
            </div>
            <p className="text-[15px] leading-7 text-muted-foreground">
              {streamdownTranslations.externalLinkWarning}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
            aria-label={streamdownTranslations.close}
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-8 pb-8">
          <div className="rounded-2xl bg-muted/80 px-5 py-4 font-mono text-sm leading-6 text-foreground">
            <p className="truncate">{url}</p>
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button
              type="button"
              variant="outline"
              className="h-11 gap-2 rounded-xl border-border/80 text-sm"
              onClick={handleCopyLink}
            >
              <Copy className="size-4" />
              <span>{streamdownTranslations.copyLink}</span>
            </Button>
            <Button
              type="button"
              className="h-11 gap-2 rounded-xl text-sm"
              onClick={handleOpenLink}
            >
              <ExternalLink className="size-4" />
              <span>{streamdownTranslations.openLink}</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

export const Markdown = memo(function Markdown(props: MarkdownProps) {
  const {
    content,
    className,
    renderMode = "static",
    showCaret = false,
    readOnly = false,
    componentOverrides,
    preserveRelativeUrls = false,
  } = props;
  const streaming = renderMode === "streaming";
  const codeCopyRootRef = useEnabledCodeCopyButtons(!readOnly && showCaret);
  const baseComponents = readOnly ? markdownReadOnlyComponents : markdownComponents;
  const components = useMemo(
    () => (componentOverrides ? { ...baseComponents, ...componentOverrides } : baseComponents),
    [baseComponents, componentOverrides],
  );

  return (
    <div ref={codeCopyRootRef}>
      <Streamdown
        className={cn(
          "chat-markdown max-w-none break-words",
          streaming ? "chat-markdown--streaming" : "chat-markdown--static",
          // Streamdown's memo equality does not include `caret` in its check,
          // so toggling the caret prop alone does not invalidate the render.
          // Mirror the visibility into a className modifier to force a re-render
          // that recomputes the inline `--streamdown-caret` style.
          showCaret ? "chat-markdown--caret-on" : "chat-markdown--caret-off",
          className,
        )}
        plugins={streamdownPlugins}
        remarkPlugins={remarkPlugins}
        {...(preserveRelativeUrls ? { rehypePlugins: relativeUrlRehypePlugins } : {})}
        components={components}
        mode={streaming ? "streaming" : "static"}
        dir="auto"
        parseIncompleteMarkdown
        normalizeHtmlIndentation
        isAnimating={showCaret}
        caret={streaming ? "block" : undefined}
        animated={false}
        linkSafety={{
          enabled: !readOnly,
          renderModal: (modalProps) => <ExternalLinkModal {...modalProps} />,
        }}
        shikiTheme={["github-light", "github-dark"] as const}
        controls={{
          code: { copy: !readOnly, download: false },
          mermaid: { copy: !readOnly, download: false, fullscreen: !readOnly, panZoom: !readOnly },
          table: { copy: !readOnly, download: false, fullscreen: !readOnly },
        }}
        translations={streamdownTranslations}
      >
        {content}
      </Streamdown>
    </div>
  );
});
