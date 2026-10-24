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

    await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "enabled",
      allowedScopes: ["m365.excel.read", "m365.excel.write"],
      planId: "pro",
      seatLimit: 1,
      subscriptionValidUntil: "2099-01-01T00:00:00.000Z",
    });
    await db.dbRun(
      "INSERT INTO users (id, email, password_hash, api_key, api_key_hash) VALUES (?, ?, 'x', ?, ?)",
      ["user-a", "owner@example.com", "key-a", "hash-a"],
    );
    await db.dbRun(
      "INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled) VALUES (?, ?, ?, 1)",
      ["tenant-a", "object-a", "user-a"],
    );
    const entitlements = await import("../src/services/m365Entitlements.js");
    const entitlement = await entitlements.resolveM365Entitlement(
      "tenant-a",
      "object-a",
    );
    assert.deepEqual(
      {
        planId: entitlement.planId,
        source: entitlement.source,
        seatLimit: entitlement.seatLimit,
        activeSeats: entitlement.activeSeats,
        seatsRemaining: entitlement.seatsRemaining,
      },
      {
        planId: "pro",
        source: "tenant",
        seatLimit: 1,
        activeSeats: 1,
        seatsRemaining: 0,
      },
    );
    await entitlements.assertM365SeatAvailable("tenant-a", "object-a");
    await assert.rejects(
      () => entitlements.assertM365SeatAvailable("tenant-a", "object-b"),
      /m365_seat_limit_reached/,
    );

    // Changing the tenant plan and billing a tenant request never touches the user's own
    // subscription or monthly_usage rows (they are separate ledgers).
    const personal = async () =>
      JSON.stringify([
        await db.dbAll("SELECT * FROM subscriptions WHERE user_id = ?", [
          "user-a",
        ]),
        await db.dbAll("SELECT * FROM monthly_usage WHERE user_id = ?", [
          "user-a",
        ]),
      ]);
    const before = await personal();
    await registry.upsertM365Tenant({
      tenantId: "tenant-a",
      status: "enabled",
      allowedScopes: ["m365.excel.read", "m365.excel.write"],
      planId: "starter",
      seatLimit: 1,
      subscriptionValidUntil: "2099-01-01T00:00:00.000Z",
    });
    const ledger = await import("../src/services/m365QuotaLedger.js");
    const scope = ledger.m365Scope({
      tenantId: "tenant-a",
      objectId: "object-a",
      userId: "user-a",
    });
    const hold = await ledger.reserveM365Quota(
      scope,
      { planId: "starter", source: "tenant" },
      1_000,
    );
    assert.ok(hold);
    await ledger.releaseM365Reservation(hold!);
    assert.equal(await personal(), before);
    assert.equal(
      (
        await db.dbGet<{ plan_name: string }>(
          "SELECT plan_name FROM m365_tenant_usage WHERE tenant_id = ? AND object_id = ?",
          ["tenant-a", "object-a"],
        )
      )?.plan_name,
      "starter",
    );
  } finally {
    process.chdir(previousDirectory);
  }
});
