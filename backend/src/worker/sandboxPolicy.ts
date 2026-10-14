import path from "node:path";

/**
 * The launcher is a privileged boundary: a compromised worker must not be
 * able to turn an environment typo into an unbounded host process. Keep the
 * hard limits here and validate every request immediately before it crosses
 * the launcher socket.
 */
export const SANDBOX_HARD_LIMITS = {
  runtimeSeconds: 45 * 60,
  memoryMb: 1536,
  cpus: 1,
  pids: 512,
  diskMb: 2048,
} as const;

const DEFAULT_MODEL_RELAY_URL =
  "http://vynor-bg-egress:8080/model/v1/chat/completions";

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  if (!/^\d+$/.test(value)) throw new Error("INVALID_SANDBOX_LIMIT");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new Error("INVALID_SANDBOX_LIMIT");
  return parsed;
}

/** Read deployment knobs, but fail closed when an operator asks for more. */
export function sandboxLimitsFromEnvironment(
  env: NodeJS.ProcessEnv = process.env,
) {
  const limits = {
    runtimeSeconds: positiveInteger(env.BG_TASK_TIMEOUT_MINUTES, 45) * 60,
    memoryMb: positiveInteger(env.BG_TASK_MEMORY_MB, 1536),
    cpus: positiveInteger(env.BG_TASK_CPUS, 1),
    pids: positiveInteger(env.BG_TASK_PIDS, 512),
    diskMb: positiveInteger(env.BG_TASK_DISK_MB, 2048),
  };
  for (const [key, value] of Object.entries(limits)) {
    if (value > SANDBOX_HARD_LIMITS[key as keyof typeof SANDBOX_HARD_LIMITS])
      throw new Error(`SANDBOX_LIMIT_EXCEEDED_${key.toUpperCase()}`);
  }
  return limits;
}

function safeAbsolutePath(value: string): boolean {
  if (!path.isAbsolute(value) || value.includes("\0")) return false;
  // Worker hosts are Linux, while policy tests also run on Windows. Preserve
  // POSIX paths instead of letting the local test runner reinterpret /var as
  // the current drive.
  const normalized = value.startsWith("/")
    ? path.posix.normalize(value)
    : path.resolve(value);
  return normalized === value || normalized === path.normalize(value);
}

function expectedModelRelayUrl(env: NodeJS.ProcessEnv): string {
  return env.BG_SANDBOX_MODEL_URL || DEFAULT_MODEL_RELAY_URL;
}

/**
 * Validate the complete launcher request. This deliberately permits only the
 * configured internal model relay; the sandbox cannot choose an arbitrary
 * URL or use the launcher as a network proxy.
 */
export function assertSandboxLaunchRequest(
  request: {
    version: number;
    taskId: string;
    inputArchive: string;
    outputDirectory: string;
    modelRelayUrl: string;
    modelToken: string;
    cacheKey: string;
    limits: Record<string, number>;
  },
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (request.version !== 1 || !/^[0-9a-f-]{36}$/i.test(request.taskId))
    throw new Error("INVALID_SANDBOX_REQUEST");
  if (
    !safeAbsolutePath(request.inputArchive) ||
    !safeAbsolutePath(request.outputDirectory) ||
    request.inputArchive === request.outputDirectory
  )
    throw new Error("INVALID_SANDBOX_PATH");
  if (!request.modelToken || request.modelToken.length > 8192)
    throw new Error("INVALID_SANDBOX_TOKEN");
  if (!/^[a-f0-9]{64}$/i.test(request.cacheKey))
    throw new Error("INVALID_SANDBOX_CACHE_KEY");

  const expected = new URL(expectedModelRelayUrl(env));
  const actual = new URL(request.modelRelayUrl);
  if (
    actual.href !== expected.href ||
    actual.protocol !== "http:" ||
    actual.username ||
    actual.password ||
    actual.search ||
    actual.hash
  )
    throw new Error("INVALID_MODEL_RELAY");

  const limits = request.limits;
  for (const key of Object.keys(SANDBOX_HARD_LIMITS) as Array<
    keyof typeof SANDBOX_HARD_LIMITS
  >) {
    const value = limits[key];
    if (
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > SANDBOX_HARD_LIMITS[key]
    )
      throw new Error(`INVALID_SANDBOX_LIMIT_${key.toUpperCase()}`);
  }
}
