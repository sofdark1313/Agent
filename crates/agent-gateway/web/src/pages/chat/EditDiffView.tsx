import { generateDiffFile } from "@git-diff-view/file";
import { DiffModeEnum, DiffView } from "@git-diff-view/react";
import { useEffect, useMemo, useState } from "react";
import "@git-diff-view/react/styles/diff-view.css";

function guessLangFromPath(filePath?: string): string {
  if (!filePath) return "txt";
  const ext = filePath.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    kt: "kotlin",
    rb: "ruby",
    swift: "swift",
    c: "c",
    cpp: "cpp",
    h: "c",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    scss: "scss",
    html: "html",
    vue: "vue",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    xml: "xml",
    md: "markdown",
    sql: "sql",
    sh: "bash",
    zsh: "bash",
    bash: "bash",
    dockerfile: "dockerfile",
    lua: "lua",
    php: "php",
    dart: "dart",
  };
  return (ext && map[ext]) || "txt";
}

function useIsDark() {
  const [isDark, setIsDark] = useState(() => document.documentElement.classList.contains("dark"));
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);
  return isDark;
}

export function EditDiffView(props: { beforeText: string; afterText: string; filePath?: string }) {
  const { beforeText, afterText, filePath } = props;
  const isDark = useIsDark();
  const lang = guessLangFromPath(filePath);

  const diffFile = useMemo(() => {
    if (!beforeText && !afterText) return undefined;
    const instance = generateDiffFile(
      filePath ?? "old",
      beforeText,
      filePath ?? "new",
      afterText,
      lang,
      lang,
    );
    instance.init();
    instance.buildSplitDiffLines();
    return instance;
  }, [beforeText, afterText, filePath, lang]);

  if (!diffFile) return null;

  return (
    <div className="edit-tool-diff-view tool-text-scroll overflow-x-auto overflow-y-hidden rounded-[10px] border border-black/[0.06] bg-white/[0.58] shadow-sm dark:border-white/[0.08] dark:bg-white/[0.04] dark:shadow-none">
      <DiffView
        diffFile={diffFile}
        diffViewMode={DiffModeEnum.Unified}
        diffViewTheme={isDark ? "dark" : "light"}
        diffViewHighlight
        diffViewAddWidget={false}
        diffViewWrap={false}
        diffViewFontSize={12}
      />
    </div>
  );
}
