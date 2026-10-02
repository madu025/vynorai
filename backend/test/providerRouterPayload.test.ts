import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAnthropicPayload,
  buildOpenAIPayload,
} from "../src/services/providerRouter.js";

const tool = {
  type: "function",
  function: {
    name: "read_file",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { filePath: { type: "string" } },
      required: ["filePath"],
    },
  },
};

test("OpenAI payload converts top-level system instructions to a message", () => {
  const payload = buildOpenAIPayload(
    {
      system: "system rules",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
    "deepseek-chat",
    "deepseek",
  );

  assert.equal(payload.system, undefined);
  assert.deepEqual(payload.messages[0], {
    role: "system",
    content: "system rules",
  });
});

test("Anthropic payload preserves tools and translates tool history", () => {
  const payload = buildAnthropicPayload(
    {
      tools: [tool],
      messages: [
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call-1",
              function: {
                name: "read_file",
                arguments: '{"filePath":"README.md"}',
              },
            },
          ],
        },
        { role: "tool", tool_call_id: "call-1", content: "contents" },
      ],
    },
    "claude-sonnet",
  );

  assert.equal(payload.tools[0].name, "read_file");
  assert.equal(payload.tools[0].input_schema.type, "object");
  assert.equal(payload.messages[0].content[0].type, "tool_use");
  assert.equal(payload.messages[1].content[0].type, "tool_result");
});
