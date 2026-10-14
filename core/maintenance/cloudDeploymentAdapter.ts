import type {
  CloudDeploymentAdapter,
  CloudDeploymentHealth,
} from "./cloudDeploymentExecutor.js";

const SHA = /^[a-f0-9]{40,64}$/i;
const TARGET = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;

export interface HttpsVpsDeploymentAdapterOptions {
  baseUrl: string;
  bearerToken: string;
  fetchFn?: typeof fetch;
}

/**
 * Concrete transport for a separately hosted VPS deployment controller.
 * Commands never come from the task or model: the controller owns the fixed
 * deploy/rollback implementation and returns signed health evidence.
 */
export class HttpsVpsDeploymentAdapter implements CloudDeploymentAdapter {
  private readonly baseUrl: string;
  private readonly bearerToken: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpsVpsDeploymentAdapterOptions) {
    const parsed = new URL(options.baseUrl);
    if (parsed.protocol !== "https:")
      throw new Error("CLOUD_DEPLOYMENT_CONTROLLER_HTTPS_REQUIRED");
    if (!options.bearerToken || options.bearerToken.length < 16)
      throw new Error("CLOUD_DEPLOYMENT_CONTROLLER_TOKEN_REQUIRED");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.bearerToken = options.bearerToken;
    this.fetchFn = options.fetchFn || fetch;
  }

  async deploy(input: {
    target: string;
    artifactDigest: string;
    rollbackSha: string;
  }): Promise<void> {
    this.assertTarget(input.target);
    this.assertSha(input.artifactDigest, "CLOUD_ARTIFACT_EVIDENCE_REQUIRED");
    this.assertSha(input.rollbackSha, "CLOUD_ROLLBACK_SHA_REQUIRED");
    await this.request("/v1/cloud-deployments/deploy", {
      method: "POST",
      body: input,
    });
  }

  async inspect(target: string): Promise<CloudDeploymentHealth> {
    this.assertTarget(target);
    const payload = await this.request(
      `/v1/cloud-deployments/health?target=${encodeURIComponent(target)}`,
      { method: "GET" },
    );
    return this.parseHealth(payload);
  }

  async rollback(input: {
    target: string;
    rollbackSha: string;
  }): Promise<CloudDeploymentHealth> {
    this.assertTarget(input.target);
    this.assertSha(input.rollbackSha, "CLOUD_ROLLBACK_SHA_REQUIRED");
    const payload = await this.request("/v1/cloud-deployments/rollback", {
      method: "POST",
      body: input,
    });
    return this.parseHealth(payload);
  }

  private async request(
    endpoint: string,
    options: { method: "GET" | "POST"; body?: unknown },
  ): Promise<unknown> {
    const response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
      method: options.method,
      headers: {
        accept: "application/json",
        ...(options.body ? { "content-type": "application/json" } : {}),
        authorization: `Bearer ${this.bearerToken}`,
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    if (!response.ok)
      throw new Error(`CLOUD_DEPLOYMENT_CONTROLLER_HTTP_${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new Error("CLOUD_DEPLOYMENT_CONTROLLER_INVALID_JSON");
    }
  }

  private parseHealth(payload: unknown): CloudDeploymentHealth {
    if (!payload || typeof payload !== "object")
      throw new Error("CLOUD_DEPLOYMENT_HEALTH_INVALID");
    const value = payload as Record<string, unknown>;
    if (
      typeof value.healthDigest !== "string" ||
      !SHA.test(value.healthDigest) ||
      typeof value.ready !== "boolean" ||
      typeof value.smokePassed !== "boolean" ||
      typeof value.logErrorsFree !== "boolean"
    )
      throw new Error("CLOUD_DEPLOYMENT_HEALTH_INVALID");
    return {
      healthDigest: value.healthDigest,
      ready: value.ready,
      smokePassed: value.smokePassed,
      logErrorsFree: value.logErrorsFree,
    };
  }

  private assertTarget(target: string): void {
    if (!TARGET.test(target))
      throw new Error("CLOUD_DEPLOYMENT_TARGET_INVALID");
  }

  private assertSha(value: string, code: string): void {
    if (!SHA.test(value)) throw new Error(code);
  }
}
