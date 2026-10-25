import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import { after, before, test } from "node:test";
import jwt from "jsonwebtoken";

const tenantId = "11111111-1111-4111-8111-111111111111";
const objectId = "22222222-2222-4222-8222-222222222222";
const apiClientId = "33333333-3333-4333-8333-333333333333";
const callerClientId = "44444444-4444-4444-8444-444444444444";
const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const other = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });

let policy: typeof import("../src/services/m365Policy.js");
let jwksServer: http.Server;

function sign(
  claims: Record<string, unknown> = {},
  options: jwt.SignOptions = {},
  key: crypto.KeyObject = privateKey,
) {
  return jwt.sign(
    {
      ver: "2.0",
      tid: tenantId,
      oid: objectId,
      scp: "m365.excel.read m365.text.read",
      azp: callerClientId,
      ...claims,
    },
    key,
    {
      algorithm: "RS256",
      keyid: "test-key",
      audience: apiClientId,
      issuer,
      expiresIn: "5m",
      ...options,
    },
  );
}

async function rejects(token: string, message: string) {
  await assert.rejects(
    () => policy.validateEntraAccessToken(token),
    (error: Error) => {
      assert.equal(error.message, message);
      return true;
    },
  );
}

before(async () => {
  Object.assign(process.env, {
    NODE_ENV: "test",
    M365_ENTRA_TENANT_ID: tenantId,
    M365_ENTRA_API_CLIENT_ID: apiClientId,
    M365_ENTRA_ALLOWED_CLIENT_IDS: callerClientId,
  });
  delete process.env.M365_ENTRA_MULTI_TENANT;
  delete process.env.M365_ENTRA_ISSUER;
  delete process.env.M365_ENTRA_API_AUDIENCE;
  jwksServer = http.createServer((_req, res) => {
    const jwk = publicKey.export({ format: "jwk" });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({ keys: [{ ...jwk, kid: "test-key", use: "sig" }] }),
    );
  });
  await new Promise<void>((resolve) =>
    jwksServer.listen(0, "127.0.0.1", resolve),
  );
  process.env.M365_ENTRA_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as any).port}/keys`;
  policy = await import("../src/services/m365Policy.js");
});

after(() => {
  jwksServer?.close();
});

test("a correctly signed Entra v2 token yields the tenant, object and scopes", async () => {
  const identity = await policy.validateEntraAccessToken(sign());
  assert.deepEqual(
    {
      tenantId: identity.tenantId,
      objectId: identity.objectId,
      scopes: identity.scopes,
    },
    {
      tenantId,
      objectId,
      scopes: ["m365.excel.read", "m365.text.read"],
    },
  );
  // Without a name or address in the token the label is the neutral fallback.
  assert.equal(identity.label, "a Microsoft work or school account");
});

test("the identity carries only a masked display label, never the raw name or address", async () => {
  const identity = await policy.validateEntraAccessToken(
    sign({ name: "Prasad Perera", preferred_username: "prasad@slts.lk" }),
  );
  assert.equal(identity.label, "Prasad P. (p***@slts.lk)");
  assert.ok(!JSON.stringify(identity).includes("prasad@slts.lk"));
});

test("the bearer check sends RS256 tokens to Entra validation", async () => {
  const identity = await policy.validateM365BearerToken(sign());
  assert.equal(identity.objectId, objectId);
});

test("a token signed by a different key is rejected", async () => {
  await assert.rejects(() =>
    policy.validateEntraAccessToken(sign({}, {}, other.privateKey)),
  );
});

test("a token with an unknown key id is rejected", async () => {
  await rejects(
    sign({}, { keyid: "rotated-away" }),
    "entra_signing_key_not_found",
  );
});

test("a token without a key id is rejected", async () => {
  const noKid = jwt.sign({ ver: "2.0" }, privateKey, { algorithm: "RS256" });
  await rejects(noKid, "invalid_entra_token");
});

test("a token that is not RS256 is rejected", async () => {
  const hs = jwt.sign({ ver: "2.0" }, "secret", {
    algorithm: "HS384",
    keyid: "test-key",
  });
  await rejects(hs, "invalid_entra_token");
});

test("an expired token is rejected", async () => {
  await assert.rejects(
    () => policy.validateEntraAccessToken(sign({}, { expiresIn: -60 })),
    /jwt expired/,
  );
});

test("a token for another audience is rejected", async () => {
  await assert.rejects(
    () =>
      policy.validateEntraAccessToken(
        sign({}, { audience: "99999999-9999-4999-8999-999999999999" }),
      ),
    /audience invalid/,
  );
});

test("a token from another issuer is rejected", async () => {
  await rejects(
    sign({}, { issuer: "https://login.microsoftonline.com/other/v2.0" }),
    "invalid_entra_identity",
  );
});

test("a token for another tenant passes signature checks but fails the tenant policy", async () => {
  const stranger = "55555555-5555-4555-8555-555555555555";
  const identity = await policy.validateEntraAccessToken(
    sign({ tid: stranger }),
  );
  assert.equal(identity.tenantId, stranger);
  assert.throws(
    () => policy.validateM365Identity(identity, "m365.excel.read"),
    /tenant_disabled/,
  );
});

test("a token without an object id is rejected", async () => {
  await rejects(sign({ oid: undefined }), "invalid_entra_identity");
});

test("a token that is not version 2.0 is rejected", async () => {
  await rejects(sign({ ver: "1.0" }), "invalid_entra_token_version");
});

test("a caller client that is not on the allow-list is rejected", async () => {
  await rejects(
    sign({ azp: "66666666-6666-4666-8666-666666666666" }),
    "untrusted_entra_client",
  );
});

test("appid is accepted when azp is absent, and neither is rejected", async () => {
  const identity = await policy.validateEntraAccessToken(
    sign({ azp: undefined, appid: callerClientId }),
  );
  assert.equal(identity.tenantId, tenantId);
  await rejects(sign({ azp: undefined }), "untrusted_entra_client");
});

test("multi-tenant mode accepts the issuer of the token's own tenant", async () => {
  const guest = "77777777-7777-4777-8777-777777777777";
  process.env.M365_ENTRA_MULTI_TENANT = "true";
  try {
    const identity = await policy.validateEntraAccessToken(
      sign(
        { tid: guest },
        { issuer: `https://login.microsoftonline.com/${guest}/v2.0` },
      ),
    );
    assert.equal(identity.tenantId, guest);
  } finally {
    delete process.env.M365_ENTRA_MULTI_TENANT;
  }
});
