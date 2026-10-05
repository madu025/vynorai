const SECRET_FILE =
  /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\.json)?|secrets?\.[^/]+|id_(?:rsa|ed25519)[^/]*|[^/]+\.(?:pem|key|p12|pfx|keystore))$/i;
const EXCLUDED_DIRECTORY =
  /(?:^|\/)(?:\.git|node_modules|vendor|dist|build|coverage|\.next|\.venv)(?:\/|$)/;

export type BackgroundUploadPathDecision =
  | "include"
  | "unsafe"
  | "secret"
  | "generated";

export function classifyBackgroundUploadPath(
  input: string,
): BackgroundUploadPathDecision {
  const value = input.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !value ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//.test(value) ||
    value.split("/").includes("..") ||
    value.includes("\0")
  )
    return "unsafe";
  if (SECRET_FILE.test(value)) return "secret";
  if (EXCLUDED_DIRECTORY.test(value)) return "generated";
  return "include";
}

/**
 * Files a background patch may never write on the user's machine: code that
 * runs on its own (git hooks, editor tasks and launch configs, dev containers,
 * CI workflows) and credentials. A sandboxed agent can be steered by content
 * in the repository, so its patch is untrusted even though we sign it.
 */
const PROTECTED_PATCH_TARGET =
  /^(?:\.git|\.vscode|\.idea|\.devcontainer|\.husky|\.github\/workflows)(?:\/|$)/i;

export type BackgroundPatchPathDecision =
  | "ok"
  | "unsafe"
  | "protected"
  | "secret";

/**
 * Validate a path from a background patch before it is written. Stricter
 * than the upload check: the path must be a plain relative POSIX path, with
 * no backslashes (on Windows "..\\x" escapes the workspace), drive letters,
 * empty, "." or ".." segments, NTFS stream names or trailing dots/spaces.
 */
export function classifyBackgroundPatchPath(
  value: string,
): BackgroundPatchPathDecision {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 1024 ||
    /[\\:]/.test(value) ||
    /[\u0000-\u001f]/.test(value) ||
    value.startsWith("/")
  )
    return "unsafe";
  const segments = value.split("/");
  if (
    segments.some((s) => s === "" || s === "." || s === ".." || /[. ]$/.test(s))
  )
    return "unsafe";
  if (PROTECTED_PATCH_TARGET.test(value)) return "protected";
  if (SECRET_FILE.test(value)) return "secret";
  return "ok";
}
