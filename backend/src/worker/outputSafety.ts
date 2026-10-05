import fs from "fs";

/**
 * The sandbox writes /output, so everything in it is attacker-controlled
 * (the agent can be steered by repository content).
 */

/**
 * Read a sandbox output file only if it is a plain file of bounded size.
 * readFile followed symlinks, so proof.json -> /proc/self/environ would have
 * read the worker's environment; and it read the whole file before checking
 * the size, so a 300 MB file could OOM the 256 MB worker.
 */
export async function readSandboxFile(
  filePath: string,
  maxBytes: number,
): Promise<Buffer> {
  const handle = await fs.promises.open(
    filePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("SANDBOX_OUTPUT_NOT_A_FILE");
    if (stat.size > maxBytes) throw new Error("SANDBOX_OUTPUT_TOO_LARGE");
    const buffer = Buffer.alloc(stat.size);
    const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/** Same rules as core/agent/backgroundUploadPolicy classifyBackgroundPatchPath. */
const PROTECTED_PATCH_TARGET =
  /^(?:\.git|\.vscode|\.idea|\.devcontainer|\.husky|\.github\/workflows)(?:\/|$)/i;
const SECRET_FILE =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|secrets?\.[^/]+|id_(?:rsa|ed25519)[^/]*|[^/]+\.(?:pem|key|p12|pfx|keystore))$/i;

export function patchPathProblem(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\\:]/.test(value) ||
    /[\u0000-\u001f]/.test(value) ||
    value.startsWith("/")
  )
    return "unsafe";
  if (
    value
      .split("/")
      .some((s) => s === "" || s === "." || s === ".." || /[. ]$/.test(s))
  )
    return "unsafe";
  if (PROTECTED_PATCH_TARGET.test(value)) return "protected";
  if (SECRET_FILE.test(value)) return "secret";
  return null;
}

/** Throw before signing if any file in the patch targets a forbidden path. */
export function assertSafePatch(bundle: unknown): void {
  const files = (bundle as { files?: unknown })?.files;
  if (!Array.isArray(files)) throw new Error("INVALID_PATCH");
  for (const file of files) {
    const problem = patchPathProblem((file as { path?: unknown })?.path);
    if (problem) throw new Error(`PATCH_PATH_${problem.toUpperCase()}`);
  }
}
