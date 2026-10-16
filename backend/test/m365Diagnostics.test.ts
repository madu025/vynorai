import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("M365 diagnostics names each failing gate, then reports ready once onboarded", async () => {
  const previousDirectory = process.cwd();
  const previousEnv = { ...process.env };
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vynor-m365-diagnostics-"),
  );
  process.chdir(temporaryDirectory);
  Object.assign(process.env, {
    NODE_ENV: "test",
    M365_ENTRA_TENANT_ID: "tenant-a",
    M365_ENTRA_API_CLIENT_ID: "api-a",
    M365_ENTRA_CLIENT_ID: "client-a",
  });
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ALLOWED_TENANT_IDS;
  delete process.env.M365_ALLOWED_TENANT_ID;
  try {
    const db = await import("../src/db.js");
    await db.initDb();
    const registry = await import("../src/services/m365TenantRegistry.js");
    const { diagnoseM365Identity, getM365Capabilities } = await import(
      "../src/services/m365Diagnostics.js"
    );
    const identity = {
      tenantId: "tenant-a",
      objectId: "object-a",
      scopes: ["m365.excel.read"],
    };
    const stage = (report: any, name: string) =>
      report.stages.find((entry: any) => entry.name === name);

    const before = await diagnoseM365Identity(identity);
    assert.equal(stage(before, "token").ok, true);
    assert.equal(stage(before, "policy:m365.excel.read").ok, true);
    assert.equal(
      stage(before, "policy:m365.excel.write").code,
      "insufficient_scope",
    );
    assert.equal(stage(before, "tenant").code, "tenant_not_registered");
    assert.equal(
      stage(before, "tenant:m365.excel.read").code,
      "tenant_disabled",
    );
    assert.equal(stage(before, "identity").code, "M365_IDENTITY_NOT_LINKED");
    assert.equal(stage(before, "credits").code, "skipped_no_identity");
    assert.deepEqual(before.ready, { read: false, write: false });
    assert.doesNotMatch(JSON.stringify(before), /@|password|api_key/);

    await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "enabled",
      allowedScopes: ["m365.excel.read", "m365.excel.write"],
      consentedAt: "2026-10-14T00:00:00.000Z",
    });
    await db.dbRun(
      "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
      ["user-a", "owner@example.com", "key-a", "hash-a"],
    );
    await db.dbRun(
      "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
      ["tenant-a", "object-a", "user-a"],
    );

    const after = await diagnoseM365Identity({
      ...identity,
      scopes: ["m365.excel.read", "m365.excel.write"],
    });
    assert.equal(stage(after, "tenant").ok, true);
    assert.equal(stage(after, "tenant").detail.hasConsentEvidence, true);
    assert.equal(stage(after, "identity").ok, true);
    assert.equal(stage(after, "credits").ok, true);
    assert.deepEqual(after.ready, { read: true, write: true });
    assert.doesNotMatch(JSON.stringify(after), /owner@example\.com|key-a/);
    const capabilities = await getM365Capabilities({
      ...identity,
      scopes: ["m365.excel.read", "m365.excel.write"],
    });
    assert.equal(capabilities.contractVersion, 1);
    assert.equal(capabilities.excel.canInspect, true);
    assert.equal(capabilities.excel.canPreview, true);
    assert.equal(capabilities.excel.canApply, true);
    assert.equal(capabilities.excel.actionKinds.length, 18);
    assert.deepEqual(
      capabilities.excel.writableActionKinds,
      capabilities.excel.actionKinds,
    );
    assert.equal(capabilities.aiAnalysis, true);
    assert.doesNotMatch(
      JSON.stringify(capabilities),
      /owner@example\.com|key-a/,
    );

    const otherTenant = await diagnoseM365Identity({
      tenantId: "tenant-b",
      objectId: "object-a",
      scopes: ["m365.excel.read", "m365.excel.write"],
    });
    assert.equal(
      stage(otherTenant, "policy:m365.excel.read").code,
      "tenant_disabled",
    );
    assert.deepEqual(otherTenant.ready, { read: false, write: false });
  } finally {
    process.chdir(previousDirectory);
    process.env = previousEnv;
  }
});

test("M365 server plan keeps generated sheet and object names valid for Excel", async () => {
  const { createServerExcelPreviewPlan, excelSafeBaseName } = await import(
    "../src/services/m365ExcelPlan.js"
  );
  const plan = createServerExcelPreviewPlan(
    {
      workbookId: "book",
      worksheetName: "Quarterly Revenue Summary 2026",
      address: "A1:B2",
      values: [
        ["h1", "h2"],
        [1, 2],
      ],
    },
    ["table", "chart", "new-sheet", "pivot-table"],
  );
  for (const action of plan.actions)
    assert.ok(action.targetSheet.length <= 31, action.targetSheet);
  assert.notEqual(
    plan.actions.find((action: any) => action.kind === "table")?.targetSheet,
    "Quarterly Revenue Summary 2026",
  );
  assert.match(excelSafeBaseName("2026"), /^S_2026$/);
  assert.match(excelSafeBaseName("Sales"), /^Sales$/);
});

test("M365 server normalizes a two-row merged header into a safe result-sheet plan", async () => {
  const { createServerExcelPreviewPlan } = await import(
    "../src/services/m365ExcelPlan.js"
  );
  const plan = createServerExcelPreviewPlan(
    {
      workbookId: "book",
      worksheetName: "Mileage",
      address: "A9:C12",
      values: [
        ["Date", "Time", ""],
        ["", "Start", "End"],
        ["2026-09-02", "08:00", "09:00"],
      ],
    },
    ["table", "pivot-table"],
  );
  assert.deepEqual(plan.normalization, {
    headerRowCount: 2,
    headers: ["Date", "Time Start", "Time End"],
  });
  assert.deepEqual(
    plan.actions.map((action: any) => action.kind),
    ["new-sheet", "table", "pivot-table"],
  );
});
