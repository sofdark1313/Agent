import assert from "node:assert/strict";
import test from "node:test";
import { createTsModuleLoader } from "../helpers/load-ts-module.mjs";

const loader = createTsModuleLoader();
const agentDebug = loader.loadModule("src/lib/debug/agentDebug.ts");

test("debug sanitizer redacts base64 data URLs", () => {
  const payload = {
    input: [
      {
        content: [
          {
            type: "input_image",
            image_url: "data:image/png;base64,aW1hZ2U=",
          },
          {
            type: "input_file",
            file_data: "data:application/pdf;base64,cGRm",
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "aW1hZ2U=",
            },
          },
          {
            type: "document",
            source: {
              type: "text",
              media_type: "text/plain",
              data: "Hello Claude",
            },
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: "aW1hZ2U=",
            },
          },
        ],
      },
    ],
  };

  const sanitized = agentDebug.__agentDebugTest.sanitizeDebugValue(payload);
  assert.equal(
    sanitized.input[0].content[0].image_url,
    "[redacted data URL: image/png, base64 chars=8]",
  );
  assert.equal(
    sanitized.input[0].content[1].file_data,
    "[redacted data URL: application/pdf, base64 chars=4]",
  );
  assert.equal(
    sanitized.input[0].content[2].source.data,
    "[redacted base64: image/png, chars=8]",
  );
  assert.equal(
    sanitized.input[0].content[3].source.data,
    "[redacted text document: text/plain, chars=12]",
  );
  assert.equal(
    sanitized.input[0].content[4].inlineData.data,
    "[redacted inlineData: image/png, chars=8]",
  );
});
