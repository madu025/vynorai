import { createHash, verify } from "node:crypto";

const SHA = /^[a-f0-9]{40,64}$/i;
const KEY_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function computeArtifactDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyArtifactAttestation(input: {
  artifactDigest: string;
  signatureBase64: string;
  publicKeyPem: string;
  keyId: string;
}): { attestationDigest: string; keyId: string } {
  if (!SHA.test(input.artifactDigest))
    throw new Error("CLOUD_ARTIFACT_DIGEST_REQUIRED");
  if (!KEY_ID.test(input.keyId))
    throw new Error("CLOUD_ARTIFACT_KEY_ID_INVALID");
  if (!input.publicKeyPem || input.publicKeyPem.length > 16_384)
    throw new Error("CLOUD_ARTIFACT_PUBLIC_KEY_REQUIRED");
  if (
    !input.signatureBase64 ||
    input.signatureBase64.length > 16_384 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.signatureBase64)
  )
    throw new Error("CLOUD_ARTIFACT_SIGNATURE_INVALID");
  let signature: Buffer;
  try {
    signature = Buffer.from(input.signatureBase64, "base64");
  } catch {
    throw new Error("CLOUD_ARTIFACT_SIGNATURE_INVALID");
  }
  if (signature.length === 0)
    throw new Error("CLOUD_ARTIFACT_SIGNATURE_INVALID");
  let valid = false;
  try {
    valid = verify(
      "sha256",
      Buffer.from(input.artifactDigest, "utf8"),
      input.publicKeyPem,
      signature,
    );
  } catch {
    throw new Error("CLOUD_ARTIFACT_SIGNATURE_INVALID");
  }
  if (!valid) throw new Error("CLOUD_ARTIFACT_SIGNATURE_MISMATCH");
  return {
    keyId: input.keyId,
    attestationDigest: createHash("sha256")
      .update(`${input.keyId}:${input.artifactDigest}:${input.signatureBase64}`)
      .digest("hex"),
  };
}

export function artifactPublicKeyFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): { publicKeyPem: string; keyId: string } {
  const publicKeyPem = (env.CLOUD_ARTIFACT_PUBLIC_KEY_PEM || "").replace(
    /\\n/g,
    "\n",
  );
  const keyId = env.CLOUD_ARTIFACT_KEY_ID || "";
  if (!publicKeyPem || !keyId)
    throw new Error("CLOUD_ARTIFACT_SIGNING_KEY_NOT_CONFIGURED");
  return { publicKeyPem, keyId };
}
