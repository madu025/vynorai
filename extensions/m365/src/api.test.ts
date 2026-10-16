import assert from "node:assert/strict";
import { test } from "node:test";
import { createM365ApiClient, M365ApiError } from "./api.js";

test("M365 API preserves structured policy errors for recovery UI", async () => {
  const client = createM365ApiClient(
    "https://api.example",
    "test-token",
    async () =>
      new Response(
        JSON.stringify({ error: { code: "invalid_entra_identity" } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
  );

  await assert.rejects(
    () => client.planExcel({}),
    (error: unknown) =>
      error instanceof M365ApiError &&
      error.code === "invalid_entra_identity" &&
      error.status === 401,
  );
});

test("M365 API turns a gateway HTML error into a traced HTTP code", async () => {
  const traces: any[] = [];
  const client = createM365ApiClient(
    "https://api.example/",
    "test-token",
    async () => new Response("<html>Bad gateway</html>", { status: 502 }),
    (trace) => traces.push(trace),
  );
  await assert.rejects(
    () => client.planExcel({}),
    (error: unknown) =>
      error instanceof M365ApiError &&
      error.code === "HTTP_502" &&
      typeof error.correlationId === "string",
  );
  assert.equal(traces[0].status, 502);
  assert.equal(traces[0].path, "/v1/m365/excel/plan");
  assert.equal(traces[0].correlationId.length > 0, true);
});

test("M365 API reports network failures and calls diagnostics with GET", async () => {
  const offline = createM365ApiClient("https://api.example", "t", async () => {
    throw new TypeError("Failed to fetch");
  });
  await assert.rejects(() => offline.diagnose(), /NETWORK_ERROR/);

  let seen: { url: string; method?: string; body?: unknown } | undefined;
  const client = createM365ApiClient(
    "https://api.example",
    "t",
    async (url, init) => {
      seen = { url: String(url), method: init?.method, body: init?.body };
      return new Response(
        JSON.stringify({ stages: [], ready: { read: true, write: true } }),
        {
          status: 200,
        },
      );
    },
  );
  assert.deepEqual((await client.diagnose()).ready, {
    read: true,
    write: true,
  });
  assert.deepEqual(seen, {
    url: "https://api.example/v1/m365/diagnostics",
    method: "GET",
    body: undefined,
  });
});

test("M365 API reads tenant capabilities without sending workbook data", async () => {
  let seen: { url: string; method?: string; body?: unknown } | undefined;
  const client = createM365ApiClient(
    "https://api.example",
    "t",
    async (url, init) => {
      seen = { url: String(url), method: init?.method, body: init?.body };
      return new Response(
        JSON.stringify({
          contractVersion: 1,
          excel: {
            canInspect: true,
            canPreview: true,
            canApply: false,
            actionKinds: ["chart"],
            writableActionKinds: [],
          },
          aiAnalysis: false,
        }),
        { status: 200 },
      );
    },
  );
  const capabilities = await client.capabilities();
  assert.equal(capabilities.excel.canInspect, true);
  assert.equal(capabilities.excel.canApply, false);
  assert.deepEqual(seen, {
    url: "https://api.example/v1/m365/excel/capabilities",
    method: "GET",
    body: undefined,
  });
});

test("M365 API reports only bounded workbook result metadata", async () => {
  let seen: { url: string; body?: string } | undefined;
  const client = createM365ApiClient(
    "https://api.example",
    "t",
    async (url, init) => {
      seen = { url: String(url), body: String(init?.body) };
      return new Response(JSON.stringify({ recorded: true }), { status: 200 });
    },
  );
  await client.reportExcelResult({
    planId: "m365_plan",
    sourceFingerprint: "a".repeat(64),
    approvalToken: "approval",
    status: "applied",
    sourceUnchanged: true,
    results: [{ kind: "chart", status: "created" }],
  });
  assert.equal(seen?.url, "https://api.example/v1/m365/excel/apply-result");
  assert.deepEqual(JSON.parse(seen!.body!), {
    planId: "m365_plan",
    sourceFingerprint: "a".repeat(64),
    approvalToken: "approval",
    status: "applied",
    sourceUnchanged: true,
    results: [{ kind: "chart", status: "created" }],
  });
});
