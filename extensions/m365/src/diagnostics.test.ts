import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DiagnosticsLog,
  describeAccessToken,
  describeError,
  describeOfficeHost,
  redactDiagnostic,
} from "./diagnostics.js";

function base64Url(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

const token = `${base64Url({ alg: "RS256" })}.${base64Url({
  ver: "2.0",
  tid: "tenant-a",
  oid: "object-a",
  aud: "api-a",
  azp: "client-a",
  scp: "m365.excel.read m365.excel.write",
  exp: 2_000,
})}.signature`;

test("diagnostics redact tokens, bearer values and OAuth query secrets", () => {
  const jwt = "eyJhbGciOiJSUzI1NiJ9.eyJ0aWQiOiJ0In0.c2lnbmF0dXJl";
  const text = redactDiagnostic(
    `got ${jwt} Bearer abc.def https://x/cb?code=SECRET&state=STATE&ok=1`,
  );
  assert.doesNotMatch(text, /eyJhbGci|abc\.def|SECRET|STATE/);
  assert.match(text, /\[jwt\]/);
  assert.match(text, /ok=1/);
});

test("token summary exposes claims and expiry but never the token", () => {
  const claims = describeAccessToken(token, 1_000_000);
  assert.deepEqual(claims, {
    version: "2.0",
    tenantId: "tenant-a",
    objectId: "object-a",
    audience: "api-a",
    clientId: "client-a",
    scopes: ["m365.excel.read", "m365.excel.write"],
    expiresInSeconds: 1_000,
  });
  assert.doesNotMatch(JSON.stringify(claims), /signature/);
  assert.equal(describeAccessToken("not-a-token"), undefined);
});

test("step log records pass and fail with duration and rethrows", async () => {
  let clock = 0;
  const log = new DiagnosticsLog(undefined, () => (clock += 5));
  assert.equal(
    await log.step(
      "ok",
      () => 42,
      (value) => ({ value }),
    ),
    42,
  );
  await assert.rejects(
    log.step("broken", () => {
      throw Object.assign(new Error("boom"), { code: "InvalidArgument" });
    }),
    /boom/,
  );
  const [ok, broken] = log.all();
  assert.equal(ok.status, "pass");
  assert.equal(ok.detail, '{"value":42}');
  assert.equal(ok.durationMs, 5);
  assert.equal(broken.status, "fail");
  assert.match(broken.detail!, /code=InvalidArgument boom/);
  assert.match(log.toText(), /PASS ok \(5 ms\)[\s\S]*FAIL broken/);
});

test("error description keeps HTTP status and correlation ID", () => {
  const text = describeError(
    Object.assign(new Error("tenant_disabled"), {
      code: "tenant_disabled",
      status: 403,
      correlationId: "corr-1",
    }),
  );
  assert.equal(text, "http=403 tenant_disabled correlationId=corr-1");
});

test("office host description reports requirement sets", () => {
  const host = describeOfficeHost({
    context: {
      diagnostics: { host: "Excel", platform: "PC", version: "16.0" },
      requirements: {
        isSetSupported: (name: string, version: string) =>
          name === "ExcelApi" && version !== "1.10"
            ? Number(version) <= 1.8
            : name !== "ExcelApi",
      },
    },
  });
  assert.equal(host.host, "Excel");
  assert.deepEqual(host.excelApi, {
    "1.1": true,
    "1.4": true,
    "1.7": true,
    "1.8": true,
    "1.9": false,
    "1.10": false,
  });
  assert.deepEqual(describeOfficeHost(undefined), {
    officeLoaded: false,
    context: false,
  });
});
