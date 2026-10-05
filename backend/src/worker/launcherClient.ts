import http from "http";

export interface SandboxLaunchRequest {
  version: 1;
  taskId: string;
  inputArchive: string;
  outputDirectory: string;
  modelRelayUrl: string;
  modelToken: string;
  cacheKey: string;
  limits: {
    runtimeSeconds: number;
    memoryMb: number;
    cpus: number;
    pids: number;
    diskMb: number;
  };
}

export interface SandboxLaunchResult {
  exitCode: number | null;
  reason: string;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string;
  workspaceDeletedAt: string;
}

export function launchSandbox(
  request: SandboxLaunchRequest,
): Promise<SandboxLaunchResult> {
  const socketPath =
    process.env.BG_LAUNCHER_SOCKET || "/run/vynor-bg/launcher.sock";
  const body = Buffer.from(JSON.stringify(request));
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: "/v1/run",
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": body.length,
        },
        timeout: (request.limits.runtimeSeconds + 120) * 1000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let bytes = 0;
        res.on("data", (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 64 * 1024)
            req.destroy(new Error("LAUNCHER_RESPONSE_TOO_LARGE"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          if ((res.statusCode || 500) >= 300)
            return reject(new Error(`LAUNCHER_HTTP_${res.statusCode}`));
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            reject(new Error("INVALID_LAUNCHER_RESPONSE"));
          }
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("LAUNCHER_TIMEOUT")));
    req.on("error", reject);
    req.end(body);
  });
}

export function cancelSandbox(taskId: string): Promise<void> {
  const socketPath =
    process.env.BG_LAUNCHER_SOCKET || "/run/vynor-bg/launcher.sock";
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        socketPath,
        path: `/v1/tasks/${encodeURIComponent(taskId)}/cancel`,
        method: "POST",
        timeout: 5_000,
      },
      (res) => {
        res.resume();
        res.on("end", () =>
          res.statusCode === 200 || res.statusCode === 404
            ? resolve()
            : reject(new Error(`LAUNCHER_CANCEL_HTTP_${res.statusCode}`)),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}
