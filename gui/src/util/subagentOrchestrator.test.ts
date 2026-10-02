import {
  runExpertCouncil,
  runReadOnlySubagents,
  selectSubagentRoles,
} from "./subagentOrchestrator";

test("prioritizes security and caps parallel subagents", () => {
  expect(
    selectSubagentRoles([
      "Architect",
      "Frontend",
      "Database",
      "Security",
      "QA",
    ]),
  ).toEqual(["Security", "Architect", "Database"]);
});

test("uses QA for tasks without a specialist signal", () => {
  expect(selectSubagentRoles(["Architect", "Engineer", "QA"])).toEqual([
    "Architect",
    "Engineer",
    "QA",
  ]);
});

test("honors the cost-controlled council depth", () => {
  expect(selectSubagentRoles(["Frontend", "Database", "Security"], 1)).toEqual([
    "Security",
  ]);
  expect(selectSubagentRoles(["Security"], 0)).toEqual([]);
});

test("runs an isolated tool-free subagent stream and reports lifecycle", async () => {
  const streamCalls: any[] = [];
  const updates: string[] = [];
  const messenger = {
    request: async () => ({ status: "success", content: [] }),
    ide: {
      getDiff: async () => ["diff --git a/file.ts b/file.ts"],
      getCurrentFile: async () => ({
        path: "file:///file.ts",
        contents: "const safe = true;",
      }),
    },
    llmStreamChat: (input: any) => {
      streamCalls.push(input);
      return (async function* () {
        yield [
          {
            role: "assistant",
            content:
              '<findings>[{"severity":"medium","confidence":"high","title":"Test gap","evidence":"file.ts has no test","recommendation":"Add a test"}]</findings>',
          },
        ];
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
  expect(streamCalls[0].messages[0].content).toContain(
    "independent read-only software engineering reviewer",
  );
  expect(updates).toEqual([
    "queued",
    "researching",
    "researching",
    "researching",
    "completed",
    "completed",
    "completed",
    "synthesizing",
    "completed",
  ]);
  expect(result[0].findings?.[0].title).toBe("Test gap");
});

test("runs a lead reviewer synthesis after parallel specialists", async () => {
  const roles: string[] = [];
  const messenger = {
    request: async () => ({ status: "success", content: [] }),
    ide: { getDiff: async () => [], getCurrentFile: async () => undefined },
    llmStreamChat: (input: any) => {
      roles.push(input.messages[0].content);
      return (async function* () {
        yield [{ role: "assistant", content: "Evidence-backed review" }];
        return undefined;
      })();
    },
  } as any;
  const result = await runExpertCouncil({
    request: "Audit API security",
    roles: ["Security", "Backend", "QA"],
    model: { title: "Reviewer" } as any,
    messenger,
    signal: new AbortController().signal,
    onInitial: () => undefined,
    onUpdate: () => undefined,
    maxAgents: 2,
  });
  expect(result.tasks.map((task) => task.role)).toEqual([
    "Security",
    "Backend",
    "Lead Reviewer",
  ]);
  expect(result.synthesis).toContain("Evidence-backed review");
  expect(roles.some((prompt) => prompt.includes("Lead Reviewer"))).toBe(true);
});
