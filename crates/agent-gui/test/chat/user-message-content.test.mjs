import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const userMessageContent = loader.loadModule("src/lib/chat/messages/userMessageContent.tsx");
const mentionReferences = loader.loadModule("src/lib/chat/messages/mentionReferences.ts");
const reactRenderLoader = createTsModuleLoader({
  mocks: {
    "react/jsx-runtime": jsxRuntime,
    "@tauri-apps/plugin-opener": {
      openUrl() {
        throw new Error("openUrl mock was not expected to be called");
      },
    },
  },
});
const renderedUserMessageContent = reactRenderLoader.loadModule(
  "src/lib/chat/messages/userMessageContent.tsx",
);

function compactSegments(segments) {
  return segments.map((segment) => {
    if (segment.type === "mention") {
      return {
        type: "mention",
        path: segment.reference.path,
        kind: segment.reference.kind,
      };
    }
    if (segment.type === "text") {
      return { type: "text", value: segment.value };
    }
    return { type: segment.type };
  });
}

test("user message skill mentions style only skill-like tokens", () => {
  assert.equal(userMessageContent.isSkillMentionToken("$code-review"), true);
  assert.equal(userMessageContent.isSkillMentionToken("$release_notes"), true);
  assert.equal(userMessageContent.isSkillMentionToken("$PATH"), false);
  assert.equal(userMessageContent.isSkillMentionToken("$PATH:"), false);
  assert.equal(userMessageContent.isSkillMentionToken("price$tag"), false);
  assert.equal(userMessageContent.isSkillMentionToken("$bad.name"), false);
});

test("file mention markdown references round trip through transcript tokenization", () => {
  const token = mentionReferences.formatFileMentionToken({
    path: "crates/agent-gui/src/components/AppUpdateButton.tsx",
    kind: "file",
  });

  assert.equal(
    token,
    "[AppUpdateButton.tsx](crates/agent-gui/src/components/AppUpdateButton.tsx)",
  );
  assert.deepEqual(compactSegments(userMessageContent.tokenizeUserMessage(`查看 ${token}`, [])), [
    { type: "text", value: "查看 " },
    {
      type: "mention",
      path: "crates/agent-gui/src/components/AppUpdateButton.tsx",
      kind: "file",
    },
  ]);
});

test("directory mention markdown references preserve trailing slash display semantics", () => {
  const token = mentionReferences.formatFileMentionToken({
    path: "docs/my folder",
    kind: "dir",
  });

  assert.equal(token, "[my folder](<docs/my folder/>)");
  assert.deepEqual(compactSegments(userMessageContent.tokenizeUserMessage(token, [])), [
    {
      type: "mention",
      path: "docs/my folder",
      kind: "dir",
    },
  ]);
});

test("directory mention markdown references require slashless labels", () => {
  assert.deepEqual(
    compactSegments(userMessageContent.tokenizeUserMessage("[my folder/](<docs/my folder/>)", [])),
    [{ type: "text", value: "[my folder/](<docs/my folder/>)" }],
  );
});

test("inline file mention tokens remain plain text", () => {
  assert.deepEqual(
    compactSegments(userMessageContent.tokenizeUserMessage("打开 @src/main.tsx 和 @docs/", [])),
    [{ type: "text", value: "打开 @src/main.tsx 和 @docs/" }],
  );
});

test("rendered commit mentions do not include native title tooltips", () => {
  const html = renderToStaticMarkup(
    jsxRuntime.jsx(renderedUserMessageContent.UserMessageContent, {
      text: "看看 [commit 0e1a4fc: init](https://github.com/example/repo/commit/0e1a4fc1234567890)",
    }),
  );

  assert.match(html, /0e1a4fc/);
  assert.doesNotMatch(html, /title=/);
});
