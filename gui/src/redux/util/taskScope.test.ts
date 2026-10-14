import { ChatHistoryItem } from "core";
import { BuiltInToolNames } from "core/tools/builtIn";
import { describe, expect, test, vi } from "vitest";

import {
  currentTaskScope,
  parseTaskScope,
  requiresTodoBeforeTool,
  resolveTaskScope,
  TASK_SCOPE_MARKER,
  taskScopeAutoPrompt,
  taskScopePrompt,
} from "./taskScope";

const user = (content: string, isAutoPrompt = false): ChatHistoryItem => ({
  message: { role: "user", content },
  contextItems: [],
  isAutoPrompt,
});

describe("task scope preflight", () => {
  test("asks for semantic inference rather than keyword counting", () => {
    const prompt = taskScopePrompt("Build something for my shop");
    expect(prompt).toContain("intended outcome");
    expect(prompt).toContain("never classify by keyword counting");
    expect(prompt).toContain("Build something for my shop");
  });

  test("teaches the semantic risk boundary for authorization work", () => {
    const prompt = taskScopePrompt("Protect an admin delete operation");
    expect(prompt).toContain("authorization behavior");
    expect(prompt).toContain("negative/positive tests");
  });

  test("parses and bounds a valid JSON result", () => {
    expect(
      parseTaskScope(
        'prefix {"scope":"complex","confidence":0.93,"impliedDeliverables":["catalog","cart"],"reason":"Several connected capabilities."} suffix',
      ),
    ).toEqual({
      scope: "complex",
      confidence: 0.93,
      impliedDeliverables: ["catalog", "cart"],
      reason: "Several connected capabilities.",
    });
    expect(
      parseTaskScope('{"scope":"large","confidence":1,"reason":"x"}'),
    ).toBeUndefined();
  });

  test("uses a second independent assessment when confidence is low", async () => {
    const complete = vi
      .fn()
      .mockResolvedValueOnce(
        '{"scope":"medium","confidence":0.5,"impliedDeliverables":[],"reason":"Unclear."}',
      )
      .mockResolvedValueOnce(
        '{"scope":"complex","confidence":0.91,"impliedDeliverables":["admin","orders"],"reason":"Multiple roles and workflows."}',
      );
    await expect(
      resolveTaskScope("Build a platform", complete),
    ).resolves.toMatchObject({
      scope: "complex",
      confidence: 0.91,
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });

  test("falls back to medium when both model results are invalid", async () => {
    const complete = vi.fn().mockResolvedValue("not json");
    await expect(resolveTaskScope("unknown", complete)).resolves.toMatchObject({
      scope: "medium",
      confidence: 0,
    });
  });

  test("complex scope blocks every tool except the initial todo", () => {
    const assessment = {
      scope: "complex" as const,
      confidence: 0.95,
      impliedDeliverables: [],
      reason: "A full product.",
    };
    const history = [
      user("Build the product"),
      user(taskScopeAutoPrompt(assessment), true),
    ];
    expect(currentTaskScope(history)).toBe("complex");
    expect(requiresTodoBeforeTool(history, BuiltInToolNames.ReadFile)).toBe(
      true,
    );
    expect(
      requiresTodoBeforeTool(history, BuiltInToolNames.UpdateTodoList),
    ).toBe(false);

    history.push({
      message: { role: "assistant", content: "" },
      contextItems: [],
      toolCallStates: [
        {
          status: "done",
          toolCallId: "todo",
          parsedArgs: {},
          toolCall: {
            id: "todo",
            type: "function",
            function: {
              name: BuiltInToolNames.UpdateTodoList,
              arguments: "{}",
            },
          },
        } as any,
      ],
    });
    expect(requiresTodoBeforeTool(history, BuiltInToolNames.ReadFile)).toBe(
      false,
    );
    expect(String(history[1].message.content)).toContain(TASK_SCOPE_MARKER);
  });

  test("passes sanitized implied deliverables to the agent", () => {
    const prompt = taskScopeAutoPrompt({
      scope: "complex",
      confidence: 0.94,
      impliedDeliverables: ["catalog", "cart", "checkout", "admin orders"],
      reason: "A connected commerce product.",
    });
    expect(prompt).toContain(
      'implied_deliverables=["catalog","cart","checkout","admin orders"]',
    );
  });
});
