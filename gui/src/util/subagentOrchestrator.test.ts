import {
  runReadOnlySubagents,
  selectSubagentRoles,
} from "./subagentOrchestrator";

test("prioritizes security and caps parallel subagents", () => {
  expect(
    selectSubagentRoles(["Architect", "Frontend", "Database", "Security", "QA"]),
  ).toEqual(["Security", "Frontend"]);
});

test("uses QA for tasks without a specialist signal", () => {
  expect(selectSubagentRoles(["Architect", "Engineer", "QA"])).toEqual(["QA"]);
});

test("honors the cost-controlled council depth", () => {
  expect(
    selectSubagentRoles(["Frontend", "Database", "Security"], 1),
  ).toEqual(["Security"]);
  expect(selectSubagentRoles(["Security"], 0)).toEqual([]);
});

test("runs an isolated tool-free subagent stream and reports lifecycle", async () => {
  const streamCalls: any[] = [];
  const updates: string[] = [];
  const messenger = {
    request: async () => ({ status: "success", content: [] }),
    ide: {
      getDiff: async () => ["diff --git a/file.ts b/file.ts"],
      getCurrentFile: async () => ({ path: "file:///file.ts", contents: "const safe = true;" }),
    },
    llmStreamChat: (input: any) => {
      streamCalls.push(input);
      return (async function* () {
        yield [{ role: "assistant", content: "Evidence-based QA report" }];
        return undefined;
      })();
    },
  } as any;

  const result = await runReadOnlySubagents({
    request: "Review this change",
    roles: ["Architect", "Engineer", "QA"],
    model: { title: "Small reviewer" } as any,
    messenger,
    signal: new AbortController().signal,
    onInitial: (tasks) => updates.push(tasks[0].status),
    onUpdate: (task) => updates.push(task.status),
  });

  expect(streamCalls[0].role).toBe("subagent");
  expect(streamCalls[0].completionOptions.tools).toBeUndefined();
  expect(streamCalls[0].messages).toHaveLength(2);
  expect(streamCalls[0].messages[0].content).toContain("read-only subagent");
  expect(updates).toEqual(["queued", "researching", "completed"]);
  expect(result[0].summary).toContain("QA report");
});
