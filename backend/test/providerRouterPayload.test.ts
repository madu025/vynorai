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

test("DeepSeek thinking is opt-in: off unless explicitly enabled", () => {
  const off = buildOpenAIPayload(
    { messages: [{ role: "user", content: "hi" }] },
    "deepseek-flash",
    "deepseek",
  );
  assert.deepEqual(off.thinking, { type: "disabled" });
  assert.equal(off.reasoning_effort, undefined);

  const on = buildOpenAIPayload(
    {
      thinking: { type: "enabled", budget_tokens: 8192 },
      reasoning_effort: "high",
      messages: [],
    },
    "deepseek-flash",
    "deepseek",
  );
  // budget_tokens is not a DeepSeek parameter and must not leak through.
  assert.deepEqual(on.thinking, { type: "enabled" });
  assert.equal(on.reasoning_effort, "high");

  // Legacy reasoning model ids imply thinking.
  const r1 = buildOpenAIPayload(
    { model: "deepseek/deepseek-r1", messages: [] },
    "deepseek-flash",
    "deepseek",
  );
  assert.deepEqual(r1.thinking, { type: "enabled" });
});

test("DeepSeek history always carries reasoning_content (400 otherwise with tools)", () => {
  const payload = buildOpenAIPayload(
    {
      thinking: { type: "enabled" },
      tools: [tool],
      messages: [
        { role: "user", content: "read it" },
        {
          role: "assistant",
          content: "",
          reasoning: "plan",
          reasoning_details: [{}],
          tool_calls: [
            { id: "c1", function: { name: "read_file", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: "c1", content: "x" },
        { role: "assistant", content: "done" },
      ],
    },
    "deepseek-flash",
    "deepseek",
  );
  const assistants = payload.messages.filter(
    (m: any) => m.role === "assistant",
  );
  assert.equal(assistants[0].reasoning_content, "plan");
  assert.equal(assistants[0].reasoning, undefined);
  assert.equal(assistants[0].reasoning_details, undefined);
  assert.equal(assistants[1].reasoning_content, "");
});

test("OpenRouter gets its unified reasoning parameter, never raw thinking", () => {
  const off = buildOpenAIPayload(
    { thinking: { type: "disabled" }, messages: [] },
    "x/y",
    "openrouter",
  );
  assert.deepEqual(off.reasoning, { enabled: false });
  assert.equal(off.thinking, undefined);
  const on = buildOpenAIPayload(
    { thinking: { type: "enabled" }, reasoning_effort: "high", messages: [] },
    "x/y",
    "openrouter",
  );
  assert.deepEqual(on.reasoning, { effort: "high" });
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
