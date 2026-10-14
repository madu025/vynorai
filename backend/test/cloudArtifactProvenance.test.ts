import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import {
  artifactPublicKeyFromEnvironment,
  computeArtifactDigest,
  verifyArtifactAttestation,
} from "../src/services/cloudArtifactProvenance.js";

test("artifact provenance verifies a signature over the pinned digest", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const digest = computeArtifactDigest(Buffer.from("artifact-v1"));
  const signature = sign(
    "sha256",
    Buffer.from(digest, "utf8"),
    keys.privateKey,
  ).toString("base64");
  const result = verifyArtifactAttestation({
    artifactDigest: digest,
    signatureBase64: signature,
    publicKeyPem: keys.publicKey
      .export({ type: "pkcs1", format: "pem" })
      .toString(),
    keyId: "release-key-2026",
  });
  assert.match(result.attestationDigest, /^[a-f0-9]{64}$/);
  assert.equal(result.keyId, "release-key-2026");
});

test("artifact provenance rejects a signature for a different digest", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signature = sign(
    "sha256",
    Buffer.from("pinned-digest", "utf8"),
    keys.privateKey,
  ).toString("base64");
  assert.throws(
    () =>
      verifyArtifactAttestation({
        artifactDigest: "a".repeat(64),
        signatureBase64: signature,
        publicKeyPem: keys.publicKey
          .export({ type: "pkcs1", format: "pem" })
          .toString(),
        keyId: "release-key-2026",
      }),
    /CLOUD_ARTIFACT_SIGNATURE_MISMATCH/,
  );
});

test("artifact public key configuration fails closed when absent", () => {
  assert.throws(
    () => artifactPublicKeyFromEnvironment({}),
    /CLOUD_ARTIFACT_SIGNING_KEY_NOT_CONFIGURED/,
  );
});
