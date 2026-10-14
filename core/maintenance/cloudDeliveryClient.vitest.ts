import { describe, expect, it, vi } from "vitest";
import { createCloudDeliveryManifest } from "./cloudDeliveryPolicy";
import { HttpCloudDeliveryControlClient } from "./cloudDeliveryClient";

const manifest = createCloudDeliveryManifest({
  runId: "11111111-1111-4111-8111-111111111111",
  taskId: "task-1",
  owner: "vynor",
  repo: "VynorAI",
  baseBranch: "main",
  headBranch: "cloud/task-1",
  baseSha: "b".repeat(40),
  headSha: "c".repeat(40),
  mode: "pr_only",
  verificationDigest: "a".repeat(64),
});

describe("HttpCloudDeliveryControlClient", () => {
  it("requires HTTPS outside localhost", () => {
    expect(
      () =>
        new HttpCloudDeliveryControlClient({
          baseUrl: "http://cloud.example.test",
          adminSecret: "a".repeat(32),
        }),
    ).toThrow("CLOUD_CONTROL_HTTPS_REQUIRED");
  });

  it("sends server-owned manifest and ordered transition requests", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 200 } as Response);
    const client = new HttpCloudDeliveryControlClient({
      baseUrl: "https://cloud.example.test",
      adminSecret: "secret-that-is-not-logged-1234",
      fetchFn,
    });
    await client.createManifest(manifest);
    await client.approve(manifest.runId, {
      actor: "admin@vynor.lk",
      scope: "cloud-pr",
      approvedAt: new Date().toISOString(),
      receiptDigest: manifest.verificationDigest,
    });
    await client.transition(manifest.runId, "pushed");
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://cloud.example.test/admin/cloud-delivery/manifests",
    );
    expect(fetchFn.mock.calls[0][1].headers["x-admin-secret"]).toBe(
      "secret-that-is-not-logged-1234",
    );
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).runId).toBe(
      manifest.runId,
    );
  });

  it("returns bounded server errors without exposing the secret", async () => {
    const secret = "secret-that-is-not-logged-1234";
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ error: "CLOUD_MANIFEST_CONFLICT" }),
    } as Response);
    const client = new HttpCloudDeliveryControlClient({
      baseUrl: "http://127.0.0.1:3333",
      adminSecret: secret,
      fetchFn,
    });
    await expect(client.transition(manifest.runId, "pushed")).rejects.toThrow(
      "CLOUD_CONTROL_CLOUD_MANIFEST_CONFLICT",
    );
    try {
      await client.transition(manifest.runId, "pushed");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
    }
  });
});
