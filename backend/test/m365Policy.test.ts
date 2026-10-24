import assert from "node:assert/strict";
import { test } from "node:test";
import jwt from "jsonwebtoken";
import { config } from "../src/config.js";
import {
  createM365ApprovalToken,
  createM365SessionToken,
  entraConfiguration,
  M365_SESSION_TTL_SECONDS,
  validateM365BearerToken,
  validateM365Identity,
  verifyM365SessionToken,
} from "../src/services/m365Policy.js";

test("M365 Entra v2 audience defaults to the API client ID", () => {
  const previous = {
    tenant: process.env.M365_ENTRA_TENANT_ID,
    api: process.env.M365_ENTRA_API_CLIENT_ID,
    client: process.env.M365_ENTRA_CLIENT_ID,
    audience: process.env.M365_ENTRA_API_AUDIENCE,
  };
  process.env.M365_ENTRA_TENANT_ID = "tenant-a";
  process.env.M365_ENTRA_API_CLIENT_ID = "api-a";
  process.env.M365_ENTRA_CLIENT_ID = "client-a";
  delete process.env.M365_ENTRA_API_AUDIENCE;
  assert.equal(entraConfiguration().apiAudience, "api-a");
  process.env.M365_ENTRA_API_AUDIENCE = "api://custom-api";
  assert.equal(entraConfiguration().apiAudience, "api://custom-api");
  Object.assign(process.env, {
    M365_ENTRA_TENANT_ID: previous.tenant,
    M365_ENTRA_API_CLIENT_ID: previous.api,
    M365_ENTRA_CLIENT_ID: previous.client,
    M365_ENTRA_API_AUDIENCE: previous.audience,
  });
});

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

test("a signed-in person gets a 30 day session that carries the same identity and scopes", async () => {
  const identity = {
    tenantId: "tenant-a",
    objectId: "person-1",
    scopes: ["m365.excel.read", "m365.excel.write"],
  };
  const { token, expiresInSeconds } = createM365SessionToken(identity);
  assert.equal(expiresInSeconds, 30 * 24 * 60 * 60);
  assert.equal(M365_SESSION_TTL_SECONDS, expiresInSeconds);
  // The verified identity also carries the original sign-in time (`authIat`) so renewals cannot
  // extend it past the 30 day cap.
  const { authIat, ...verified } = verifyM365SessionToken(token);
  assert.deepEqual(verified, identity);
  assert.ok(authIat && Math.abs(authIat - Date.now() / 1000) < 10);
  // The same entry point the routes use accepts it without calling Microsoft.
  const { authIat: viaBearer, ...bearer } =
    await validateM365BearerToken(token);
  assert.deepEqual(bearer, identity);
  assert.equal(viaBearer, authIat);
  const claims = jwt.decode(token) as { exp: number; iat: number };
  assert.equal(claims.exp - claims.iat, 30 * 24 * 60 * 60);
});

test("a session is refused when tampered with, expired, signed otherwise or of another kind", async () => {
  const identity = {
    tenantId: "t",
    objectId: "o",
    scopes: ["m365.excel.read"],
  };
  const { token } = createM365SessionToken(identity);
  const parts = token.split(".");
  const forgedPayload = Buffer.from(
    JSON.stringify({
      kind: "m365_session",
      tid: "other",
      oid: "o",
      scp: "m365.excel.write",
    }),
  ).toString("base64url");
  assert.throws(() =>
    verifyM365SessionToken([parts[0], forgedPayload, parts[2]].join(".")),
  );
  const expired = jwt.sign(
    { kind: "m365_session", tid: "t", oid: "o", scp: "m365.excel.read" },
    config.jwtSecret,
    { algorithm: "HS256", expiresIn: -10 },
  );
  assert.throws(() => verifyM365SessionToken(expired), /expired/);
  const wrongSecret = jwt.sign(
    { kind: "m365_session", tid: "t", oid: "o", scp: "m365.excel.read" },
    "another-secret-another-secret-123456",
    { algorithm: "HS256", expiresIn: 60 },
  );
  assert.throws(() => verifyM365SessionToken(wrongSecret));
  // An approval token is signed with the same secret but must never pass as a session.
  const approval = createM365ApprovalToken({
    planId: "p",
    tenantId: "t",
    objectId: "o",
    sourceFingerprint: "f",
  });
  assert.throws(() => verifyM365SessionToken(approval), /invalid_m365_session/);
  await assert.rejects(
    validateM365BearerToken(approval),
    /invalid_m365_session/,
  );
});
