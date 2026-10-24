import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  COMPANION_FEATURES,
  classifyHost,
  companionOnlyFeatures,
  compareVersions,
  deriveCompanionState,
  noCompanionTransport,
  probeCompanion,
  type CompanionHelloRequest,
  type CompanionHelloResponse,
  type CompanionPolicy,
} from "./companionState.js";

const WINDOWS = classifyHost("PC");
const POLICY: CompanionPolicy = {
  trustedSignerThumbprints: ["abc123"],
  minCompanionVersion: "1.2.0",
  nonce: "nonce-1",
};

function reply(over: Partial<CompanionHelloResponse> = {}) {
  return {
    contractVersion: "2026-10-24.windows-companion.v1",
    type: "hello-ack",
    nonce: "nonce-1",
    companionVersion: "1.2.3",
    signerThumbprint: "ABC123",
    signature: "sig",
    tenantAllowed: true,
    features: ["solver", "vba-com", "unknown-feature"],
    rawWorkbookExport: false,
    ...over,
  } as CompanionHelloResponse;
}
const ok = (over?: Partial<CompanionHelloResponse>) => ({
  kind: "response" as const,
  response: reply(over),
  signatureVerified: true,
});

test("host classification: Web, Windows, Mac and unknown", () => {
  assert.deepEqual(classifyHost("OfficeOnline"), {
    platform: "web",
    surface: "web",
  });
  assert.deepEqual(classifyHost("PC"), {
    platform: "windows",
    surface: "desktop",
  });
  assert.deepEqual(classifyHost("Mac"), {
    platform: "mac",
    surface: "desktop",
  });
  assert.equal(classifyHost(undefined).platform, "unknown");
});

test("Web and Mac are unsupported hosts even with a perfect reply", () => {
  for (const platform of ["OfficeOnline", "Mac", "iOS", undefined]) {
    const host = classifyHost(platform);
    const status = deriveCompanionState(host, ok(), POLICY);
    assert.equal(status.state, "unsupported_host");
    assert.deepEqual(companionOnlyFeatures(status, host), []);
  }
});

test("no answer means not_installed and exposes nothing", () => {
  const status = deriveCompanionState(WINDOWS, { kind: "no_response" }, POLICY);
  assert.equal(status.state, "not_installed");
  assert.deepEqual(companionOnlyFeatures(status, WINDOWS), []);
});

test("unsigned, untrusted, replayed or data-exporting replies are not_signed", () => {
  const cases = [
    { ...ok(), signatureVerified: false },
    ok({ signerThumbprint: "other" }),
    ok({ nonce: "old-nonce" }),
    ok({ rawWorkbookExport: true as unknown as false }),
  ];
  for (const handshake of cases)
    assert.equal(
      deriveCompanionState(WINDOWS, handshake, POLICY).state,
      "not_signed",
    );
  assert.equal(
    deriveCompanionState(WINDOWS, ok(), {
      ...POLICY,
      trustedSignerThumbprints: [],
    }).state,
    "not_signed",
  );
});

test("version older than the minimum, or unreadable, is version_mismatch", () => {
  assert.equal(
    deriveCompanionState(WINDOWS, ok({ companionVersion: "1.1.9" }), POLICY)
      .state,
    "version_mismatch",
  );
  assert.equal(
    deriveCompanionState(WINDOWS, ok({ companionVersion: "beta" }), POLICY)
      .state,
    "version_mismatch",
  );
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("1.2", "1.2.0"), 0);
  assert.equal(compareVersions("x", "1.0"), undefined);
});

test("a tenant that is not allow-listed gets no features", () => {
  const status = deriveCompanionState(
    WINDOWS,
    ok({ tenantAllowed: false }),
    POLICY,
  );
  assert.equal(status.state, "tenant_not_allowed");
  assert.deepEqual(companionOnlyFeatures(status, WINDOWS), []);
});

test("ready on Windows desktop lists only known features", () => {
  const status = deriveCompanionState(WINDOWS, ok(), POLICY);
  assert.equal(status.state, "ready");
  assert.deepEqual(companionOnlyFeatures(status, WINDOWS), [
    "vba-com",
    "solver",
  ]);
  // The same ready status never leaks onto another host.
  assert.deepEqual(companionOnlyFeatures(status, classifyHost("Mac")), []);
  assert.deepEqual(
    companionOnlyFeatures(status, classifyHost("OfficeOnline")),
    [],
  );
});

test("this repository's transport reports not_installed; a throwing transport fails closed", async () => {
  const request: CompanionHelloRequest = {
    contractVersion: "2026-10-24.windows-companion.v1",
    type: "hello",
    nonce: "nonce-1",
    tenantId: "tenant",
    minCompanionVersion: "1.2.0",
  };
  assert.equal(
    (await probeCompanion(WINDOWS, noCompanionTransport, request, POLICY))
      .state,
    "not_installed",
  );
  const throwing = {
    async handshake(): Promise<never> {
      throw new Error("boom");
    },
  };
  assert.equal(
    (await probeCompanion(WINDOWS, throwing, request, POLICY)).state,
    "not_installed",
  );
  let called = false;
  const spy = {
    async handshake() {
      called = true;
      return ok();
    },
  };
  assert.equal(
    (await probeCompanion(classifyHost("Mac"), spy, request, POLICY)).state,
    "unsupported_host",
  );
  assert.equal(called, false, "no probe is made on an unsupported host");
});

test("vocabulary matches packages/m365-contracts/src/companion.ts", () => {
  const source = readFileSync(
    new URL(
      "../../../packages/m365-contracts/src/companion.ts",
      import.meta.url,
    ),
    "utf8",
  );
  for (const feature of COMPANION_FEATURES)
    assert.ok(source.includes(`"${feature}"`), feature);
  for (const state of [
    "not_installed",
    "not_signed",
    "unsupported_host",
    "version_mismatch",
    "tenant_not_allowed",
    "ready",
  ])
    assert.ok(source.includes(`"${state}"`), state);
});
