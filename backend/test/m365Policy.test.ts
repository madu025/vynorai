import assert from "node:assert/strict";
import { test } from "node:test";
import { validateM365Identity } from "../src/services/m365Policy.js";

test("M365 identity denies missing tenant configuration", () => {
  const previous = {
    tenant: process.env.M365_ENTRA_TENANT_ID,
    api: process.env.M365_ENTRA_API_CLIENT_ID,
    client: process.env.M365_ENTRA_CLIENT_ID,
    multi: process.env.M365_ENTRA_MULTI_TENANT,
    allowed: process.env.M365_ALLOWED_TENANT_ID,
  };
  process.env.M365_ENTRA_TENANT_ID = "tenant-a";
  process.env.M365_ENTRA_API_CLIENT_ID = "api-a";
  process.env.M365_ENTRA_CLIENT_ID = "client-a";
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ALLOWED_TENANT_ID;
  assert.throws(
    () =>
      validateM365Identity(
        {
          tenantId: "tenant-b",
          objectId: "user-a",
          scopes: ["m365.excel.read"],
        },
        "m365.excel.read",
      ),
    /tenant_disabled/,
  );
  Object.assign(process.env, {
    M365_ENTRA_TENANT_ID: previous.tenant,
    M365_ENTRA_API_CLIENT_ID: previous.api,
    M365_ENTRA_CLIENT_ID: previous.client,
    M365_ENTRA_MULTI_TENANT: previous.multi,
    M365_ALLOWED_TENANT_ID: previous.allowed,
  });
});

test("M365 identity denies cross-tenant and missing scopes", () => {
  process.env.M365_ENTRA_TENANT_ID = "tenant-a";
  process.env.M365_ENTRA_API_CLIENT_ID = "api-a";
  process.env.M365_ENTRA_CLIENT_ID = "client-a";
  delete process.env.M365_ENTRA_MULTI_TENANT;
  process.env.M365_ALLOWED_TENANT_ID = "tenant-a";
  assert.throws(
    () =>
      validateM365Identity(
        {
          tenantId: "tenant-b",
          objectId: "user-a",
          scopes: ["m365.excel.read"],
        },
        "m365.excel.read",
      ),
    /tenant_disabled/,
  );
  assert.throws(
    () =>
      validateM365Identity(
        {
          tenantId: "tenant-a",
          objectId: "user-a",
          scopes: ["m365.excel.read"],
        },
        "m365.excel.write",
      ),
    /insufficient_scope/,
  );
});

test("M365 multitenant mode accepts a tenant unless an allowlist rejects it", () => {
  process.env.M365_ENTRA_TENANT_ID = "home-tenant";
  process.env.M365_ENTRA_API_CLIENT_ID = "api-a";
  process.env.M365_ENTRA_CLIENT_ID = "client-a";
  process.env.M365_ENTRA_MULTI_TENANT = "true";
  delete process.env.M365_ALLOWED_TENANT_ID;
  validateM365Identity(
    {
      tenantId: "customer-tenant",
      objectId: "user-a",
      scopes: ["m365.excel.read"],
    },
    "m365.excel.read",
  );
  process.env.M365_ALLOWED_TENANT_ID = "another-tenant";
  assert.throws(
    () =>
      validateM365Identity(
        {
          tenantId: "customer-tenant",
          objectId: "user-a",
          scopes: ["m365.excel.read"],
        },
        "m365.excel.read",
      ),
    /tenant_disabled/,
  );
  delete process.env.M365_ALLOWED_TENANT_ID;
  delete process.env.M365_ENTRA_MULTI_TENANT;
});
