import type {
  CloudDeliveryApproval,
  CloudDeliveryManifest,
  CloudDeliveryState,
} from "./cloudDeliveryPolicy.js";

export interface CloudDeliveryTransitionEvidence {
  artifactDigest?: string;
  artifactAttestationDigest?: string;
  artifactSignature?: string;
  artifactKeyId?: string;
  deploymentTarget?: string;
  healthDigest?: string;
  ready?: boolean;
  smokePassed?: boolean;
  logErrorsFree?: boolean;
}

export interface CloudDeliveryControlClient {
  createManifest(manifest: CloudDeliveryManifest): Promise<void>;
  approve(runId: string, approval: CloudDeliveryApproval): Promise<void>;
  transition(
    runId: string,
    state: CloudDeliveryState,
    evidence?: CloudDeliveryTransitionEvidence,
  ): Promise<void>;
}

export interface HttpCloudDeliveryControlClientOptions {
  baseUrl: string;
  adminSecret: string;
  fetchFn?: typeof fetch;
}

/**
 * Server-owned delivery client used by a cloud worker. It sends only hashes,
 * IDs and state/evidence metadata; the admin secret is never included in an
 * error or response. Production callers must use HTTPS.
 */
export class HttpCloudDeliveryControlClient
  implements CloudDeliveryControlClient
{
  private readonly baseUrl: string;
  private readonly adminSecret: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpCloudDeliveryControlClientOptions) {
    const parsed = new URL(options.baseUrl);
    const local =
      parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
    if (parsed.protocol !== "https:" && !local)
      throw new Error("CLOUD_CONTROL_HTTPS_REQUIRED");
    if (!options.adminSecret || options.adminSecret.length < 16)
      throw new Error("CLOUD_CONTROL_SECRET_REQUIRED");
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.adminSecret = options.adminSecret;
    this.fetchFn = options.fetchFn || fetch;
  }

  async createManifest(manifest: CloudDeliveryManifest): Promise<void> {
    await this.request("/admin/cloud-delivery/manifests", {
      method: "POST",
      body: {
        runId: manifest.runId,
        taskId: manifest.taskId,
        owner: manifest.repository.owner,
        repo: manifest.repository.repo,
        baseBranch: manifest.baseBranch,
        headBranch: manifest.headBranch,
        baseSha: manifest.baseSha,
        headSha: manifest.headSha,
        mode: manifest.mode,
        verificationDigest: manifest.verificationDigest,
        capabilityDigest: manifest.capabilityDigest,
      },
    });
  }

  async approve(runId: string, approval: CloudDeliveryApproval): Promise<void> {
    await this.request(
      `/admin/cloud-delivery/manifests/${encodeURIComponent(runId)}/approve`,
      {
        method: "POST",
        body: approval,
      },
    );
  }

  async transition(
    runId: string,
    state: CloudDeliveryState,
    evidence?: CloudDeliveryTransitionEvidence,
  ): Promise<void> {
    await this.request(
      `/admin/cloud-delivery/manifests/${encodeURIComponent(runId)}/transition`,
      { method: "POST", body: { state, ...evidence } },
    );
  }

  private async request(
    endpoint: string,
    options: { method: "POST"; body: unknown },
  ): Promise<void> {
    const response = await this.fetchFn(`${this.baseUrl}${endpoint}`, {
      method: options.method,
      headers: {
        "content-type": "application/json",
        "x-admin-secret": this.adminSecret,
      },
      body: JSON.stringify(options.body),
    });
    if (response.ok) return;
    let code = `HTTP_${response.status}`;
    try {
      const payload = (await response.json()) as { error?: string };
      if (payload?.error && /^[A-Z0-9_.-]{3,120}$/.test(payload.error))
        code = payload.error;
    } catch {
      // Preserve the bounded status code when the server response is not JSON.
    }
    throw new Error(`CLOUD_CONTROL_${code}`);
  }
}
