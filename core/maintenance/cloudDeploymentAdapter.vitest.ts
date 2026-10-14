import { describe, expect, it, vi } from "vitest";
import { HttpsVpsDeploymentAdapter } from "./cloudDeploymentAdapter";

const SHA = "a".repeat(64);
const health = {
  healthDigest: "b".repeat(64),
  ready: true,
  smokePassed: true,
  logErrorsFree: true,
};

function response(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("HttpsVpsDeploymentAdapter", () => {
  it("uses fixed HTTPS controller endpoints and returns health evidence", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(response({ ok: true }))
      .mockResolvedValueOnce(response(health));
    const adapter = new HttpsVpsDeploymentAdapter({
      baseUrl: "https://deploy.example.test",
      bearerToken: "controller-secret-123",
      fetchFn,
    });
    await adapter.deploy({
      target: "staging",
      artifactDigest: SHA,
      rollbackSha: SHA,
    });
    await expect(adapter.inspect("staging")).resolves.toEqual(health);
    expect(fetchFn.mock.calls[0][0]).toBe(
      "https://deploy.example.test/v1/cloud-deployments/deploy",
    );
    expect(fetchFn.mock.calls[0][1].headers).toMatchObject({
      authorization: "Bearer controller-secret-123",
    });
  });

  it("fails closed for HTTP, invalid health and invalid target", async () => {
    expect(
      () =>
        new HttpsVpsDeploymentAdapter({
          baseUrl: "http://deploy.example.test",
          bearerToken: "controller-secret-123",
        }),
    ).toThrow("CLOUD_DEPLOYMENT_CONTROLLER_HTTPS_REQUIRED");
    const fetchFn = vi.fn().mockResolvedValue(response({ ready: true }));
    const adapter = new HttpsVpsDeploymentAdapter({
      baseUrl: "https://deploy.example.test",
      bearerToken: "controller-secret-123",
      fetchFn,
    });
    await expect(adapter.inspect("../escape")).rejects.toThrow(
      "CLOUD_DEPLOYMENT_TARGET_INVALID",
    );
    await expect(adapter.inspect("staging")).rejects.toThrow(
      "CLOUD_DEPLOYMENT_HEALTH_INVALID",
    );
  });
});
