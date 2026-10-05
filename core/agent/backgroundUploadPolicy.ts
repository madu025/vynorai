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
