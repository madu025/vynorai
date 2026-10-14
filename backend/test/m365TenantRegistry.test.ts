import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("M365 tenant registry fails closed and enforces per-tenant action scopes", async () => {
  const previousDirectory = process.cwd();
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "vynor-m365-tenant-"),
  );
  process.chdir(temporaryDirectory);
  process.env.NODE_ENV = "test";
  try {
    const db = await import("../src/db.js");
    await db.initDb();
    const registry = await import("../src/services/m365TenantRegistry.js");

    await assert.rejects(
      () => registry.requireM365TenantScope("tenant-a", "m365.excel.read"),
      /tenant_disabled/,
    );
    await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "disabled",
      allowedScopes: ["m365.excel.read"],
    });
    await assert.rejects(
      () => registry.requireM365TenantScope("tenant-a", "m365.excel.read"),
      /tenant_disabled/,
    );

    const enabled = await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "enabled",
      displayName: "Customer A",
      allowedScopes: ["m365.excel.read"],
      consentedAt: "2026-10-14T00:00:00.000Z",
    });
    assert.deepEqual(enabled.allowedScopes, ["m365.excel.read"]);
    await registry.requireM365TenantScope("tenant-a", "m365.excel.read");
    await assert.rejects(
      () => registry.requireM365TenantScope("tenant-a", "m365.excel.write"),
      /tenant_scope_disabled/,
    );

    await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "enabled",
      allowedScopes: ["m365.excel.read", "m365.excel.write"],
    });
    await registry.requireM365TenantScope("tenant-a", "m365.excel.write");
    assert.equal((await registry.listM365Tenants()).length, 1);
  } finally {
    process.chdir(previousDirectory);
  }
});
