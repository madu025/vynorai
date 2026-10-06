const DIAGNOSTICS_STORAGE_KEY = "vynorai.runtimeDiagnostics.v1";
const MAX_DIAGNOSTICS = 20;

export interface RuntimeDiagnosticInput {
  error: unknown;
  modelTitle?: string;
  provider?: string;
  sessionId?: string;
  mode?: string;
  historyLength: number;
  workspace?: {
    connected: boolean;
    rootCount: number;
    trusted?: boolean;
    revision?: number;
  };
  toolStatusCounts: Record<string, number>;
}

export interface RuntimeDiagnostic {
  schemaVersion: 1;
  id: string;
  recordedAt: string;
  category: "model-response";
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
    type?: string;
    status?: string | number;
  };
  model?: { title?: string; provider?: string };
  session: { id?: string; mode?: string; historyLength: number };
  workspace?: RuntimeDiagnosticInput["workspace"];
  toolStatusCounts: Record<string, number>;
  fingerprint: string;
  analysis: { likelyCause: string; recovery: string };
  privacy: "No prompt, file content, absolute path, or credential is included.";
}

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object"
    ? (value as UnknownRecord)
    : undefined;
}

function parseJsonRecord(value: unknown): UnknownRecord | undefined {
  if (typeof value !== "string" || !value.trim().startsWith("{")) return;
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return;
  }
}

function firstString(...values: unknown[]): string | undefined {
  return values.find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
}

function classifyError(code: string, type: string, message: string) {
  const text = `${code} ${type} ${message}`.toLowerCase();
  if (/quota_exceeded|monthly_limit_reached|credits/.test(text)) {
    return {
      likelyCause: "The selected model account has exhausted its credit quota.",
      recovery:
        "Switch to another configured model, upgrade the account, or wait for quota reset.",
    };
  }
  if (/cannot read properties of undefined|\.map\(|\.find\(/.test(text)) {
    return {
      likelyCause:
        "The UI received incomplete runtime state while handling a model or tool response.",
      recovery:
        "Keep the report and stack, reload the window, then retry once on the latest extension build.",
    };
  }
  if (/timeout|timed out|premature close|network|fetch failed/.test(text)) {
    return {
      likelyCause:
        "The model or network request ended before the response completed.",
      recovery: "Check connectivity and retry the last request once.",
    };
  }
  return {
    likelyCause:
      "The model-response pipeline raised an unclassified runtime error.",
    recovery:
      "Copy this diagnostic and inspect the error code and stack before retrying.",
  };
}

function extractError(error: unknown): RuntimeDiagnostic["error"] {
  const outer = asRecord(error);
  const outerMessage = outer?.message;
  const parsedMessage = parseJsonRecord(outerMessage);
  const nested = asRecord(outer?.error);
  const parsedNested = asRecord(parsedMessage?.error);
  const message =
    firstString(
      parsedNested?.message,
      nested?.message,
      parsedMessage?.message,
      typeof outerMessage === "string" && !parsedMessage
        ? outerMessage
        : undefined,
      typeof outer?.error === "string" ? outer.error : undefined,
      typeof error === "string" ? error : undefined,
    ) ?? "Unknown runtime error";
  const code = firstString(
    parsedNested?.code,
    nested?.code,
    parsedMessage?.code,
    outer?.code,
  );
  const type = firstString(
    parsedNested?.type,
    nested?.type,
    parsedMessage?.type,
    outer?.type,
  );
  const status =
    parsedNested?.status ??
    nested?.status ??
    parsedMessage?.status ??
    outer?.status ??
    outer?.statusCode;
  const stack = firstString(outer?.stack);

  return {
    name: firstString(outer?.name) ?? "Error",
    message: redact(message, 600),
    ...(stack ? { stack: redact(stack, 2400) } : {}),
    ...(code ? { code: redact(code, 120) } : {}),
    ...(type ? { type: redact(type, 120) } : {}),
    ...(typeof status === "string" || typeof status === "number"
      ? { status }
      : {}),
  };
}

function redact(value: string, maxLength: number): string {
  return value
    .replace(
      /file\+\.vscode-resource\.vscode-cdn\.net\/[^\s)]+/gi,
      "[LOCAL_RESOURCE]",
    )
    .replace(/[A-Za-z]%3A(?:%5C|\/)[^\s)]+/gi, "[LOCAL_PATH]")
    .replace(
      /(bearer|api[_-]?key|token|password)\s*[:=]\s*[^\s,;]+/gi,
      "$1: [REDACTED]",
    )
    .replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")
    .replace(/[A-Za-z]:\\[^\n]+/g, "[LOCAL_PATH]")
    .replace(/\/(?:Users|home)\/[^\s)]+/g, "[LOCAL_PATH]")
    .slice(0, maxLength);
}

export function createRuntimeDiagnostic(
  input: RuntimeDiagnosticInput,
): RuntimeDiagnostic {
  const error = extractError(input.error);
  const analysis = classifyError(
    error.code ?? "",
    error.type ?? "",
    error.message,
  );
  const fingerprint = [
    "model-response",
    error.name,
    error.code ?? "",
    error.type ?? "",
    error.message,
    input.sessionId ?? "",
  ].join("|");

  return {
    schemaVersion: 1,
    id:
      globalThis.crypto?.randomUUID?.() ??
      `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    recordedAt: new Date().toISOString(),
    category: "model-response",
    error,
    model: { title: input.modelTitle, provider: input.provider },
    session: {
      id: input.sessionId,
      mode: input.mode,
      historyLength: input.historyLength,
    },
    workspace: input.workspace,
    toolStatusCounts: input.toolStatusCounts,
    fingerprint,
    analysis,
    privacy:
      "No prompt, file content, absolute path, or credential is included.",
  };
}

export function saveRuntimeDiagnostic(diagnostic: RuntimeDiagnostic): void {
  try {
    const existing = JSON.parse(
      window.localStorage.getItem(DIAGNOSTICS_STORAGE_KEY) ?? "[]",
    );
    const history = Array.isArray(existing) ? existing : [];
    if (history.some((item) => item?.fingerprint === diagnostic.fingerprint)) {
      return;
    }
    window.localStorage.setItem(
      DIAGNOSTICS_STORAGE_KEY,
      JSON.stringify([...history, diagnostic].slice(-MAX_DIAGNOSTICS)),
    );
  } catch {
    // Diagnostics must never become another reason the chat fails.
  }
}
