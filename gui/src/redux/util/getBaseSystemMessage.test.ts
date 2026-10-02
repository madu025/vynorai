import { ModelDescription, Tool } from "core";
import {
  DEFAULT_AGENT_SYSTEM_MESSAGE,
  DEFAULT_CHAT_SYSTEM_MESSAGE,
  DEFAULT_PLAN_SYSTEM_MESSAGE,
} from "core/llm/defaultSystemMessages";
import {
  getBaseSystemMessage,
  NO_TOOL_WARNING,
  VYNOR_EXPERT_TEAM_SYSTEM_MESSAGE,
} from "./getBaseSystemMessage";
import type { WorkspaceSnapshot } from "core/workspace/types";

test("getBaseSystemMessage should return the correct system message based on mode", () => {
  const mockModel = {
    baseChatSystemMessage: "Custom Chat System Message",
    basePlanSystemMessage: "Custom Plan System Message",
    baseAgentSystemMessage: "Custom Agent System Message",
  } as ModelDescription;

  const mockTool = {
    function: {
      name: "testTool",
      description: "Test tool",
      parameters: {},
    },
  } as Tool;

  // Test agent mode with custom message and tools
  expect(getBaseSystemMessage("agent", mockModel, [mockTool])).toBe(
    "Custom Agent System Message",
  );

  // Test plan mode with custom message and tools
  expect(getBaseSystemMessage("plan", mockModel, [mockTool])).toBe(
    "Custom Plan System Message",
  );

  // Test chat mode with custom message and tools
  expect(getBaseSystemMessage("chat", mockModel, [mockTool])).toBe(
    "Custom Chat System Message",
  );

  // Test agent mode with default message and tools
  expect(
    getBaseSystemMessage("agent", {} as ModelDescription, [mockTool]),
  ).toBe(DEFAULT_AGENT_SYSTEM_MESSAGE);

  // Test plan mode with default message and tools
  expect(getBaseSystemMessage("plan", {} as ModelDescription, [mockTool])).toBe(
    DEFAULT_PLAN_SYSTEM_MESSAGE,
  );

  // Test chat mode with default message and tools
  expect(getBaseSystemMessage("chat", {} as ModelDescription, [mockTool])).toBe(
    DEFAULT_CHAT_SYSTEM_MESSAGE,
  );
});

test("expert team contract is opt-in and restricted to agent mode", () => {
  const model = { baseAgentSystemMessage: "Agent" } as ModelDescription;
  const tool = { function: { name: "read", parameters: {} } } as Tool;

  expect(getBaseSystemMessage("agent", model, [tool], true)).toBe(
    "Agent" + VYNOR_EXPERT_TEAM_SYSTEM_MESSAGE,
  );
  expect(getBaseSystemMessage("chat", model, [tool], true)).not.toContain(
    "VYNOR EXPERT TEAM WORKFLOW",
  );
});

test("expert team includes only explicitly supplied project memories", () => {
  const model = { baseAgentSystemMessage: "Agent" } as ModelDescription;
  const tool = { function: { name: "read", parameters: {} } } as Tool;
  const result = getBaseSystemMessage(
    "agent",
    model,
    [tool],
    true,
    [{ id: "1", text: "Use pnpm", createdAt: 1 }],
    ["Engineer", "QA"],
  );

  expect(result).toContain("USER-APPROVED PROJECT MEMORY");
  expect(result).toContain("Use pnpm");
  expect(result).toContain("Engineer, QA");
  expect(getBaseSystemMessage("agent", model, [tool], false)).not.toContain(
    "USER-APPROVED PROJECT MEMORY",
  );
});

test("getBaseSystemMessage should append no-tools warning for agent/plan modes without tools", () => {
  const mockModel = {
    baseChatSystemMessage: "Custom Chat System Message",
    basePlanSystemMessage: "Custom Plan System Message",
    baseAgentSystemMessage: "Custom Agent System Message",
  } as ModelDescription;

  // Test agent mode without tools
  expect(getBaseSystemMessage("agent", mockModel, [])).toBe(
    "Custom Agent System Message" + NO_TOOL_WARNING,
  );

  // Test plan mode without tools
  expect(getBaseSystemMessage("plan", mockModel, [])).toBe(
    "Custom Plan System Message" + NO_TOOL_WARNING,
  );

  // Test chat mode without tools (should not append warning)
  expect(getBaseSystemMessage("chat", mockModel, [])).toBe(
    "Custom Chat System Message",
  );

  // Test agent mode with undefined tools
  expect(getBaseSystemMessage("agent", mockModel)).toBe(
    "Custom Agent System Message" + NO_TOOL_WARNING,
  );

  // Test plan mode with undefined tools
  expect(getBaseSystemMessage("plan", mockModel)).toBe(
    "Custom Plan System Message" + NO_TOOL_WARNING,
  );
});

test("appends connected workspace evidence to the model prompt", () => {
  const snapshot: WorkspaceSnapshot = {
    id: "workspace-1",
    revision: 1,
    roots: [{ id: "root-1", name: "VynorAI" }],
    manifests: [],
    instructions: [],
    index: [{ rootId: "root-1", status: "ready" }],
    trusted: true,
    capabilities: ["readFile"],
    createdAt: 1,
  };

  const result = getBaseSystemMessage(
    "chat",
    { baseChatSystemMessage: "Chat" } as ModelDescription,
    [],
    false,
    [],
    [],
    "",
    "",
    snapshot,
  );

  expect(result).toContain("WORKSPACE CONNECTION");
  expect(result).toContain("Roots: VynorAI");
});
