export type DiagnosticStatus = "pass" | "fail" | "skip" | "info";

export interface DiagnosticEntry {
  at: string;
  step: string;
  status: DiagnosticStatus;
  detail?: string;
  durationMs?: number;
}

const MAX_ENTRIES = 300;

/**
 * Removes anything shaped like a credential before it reaches the panel or the clipboard:
 * JWTs, bearer values, OAuth codes and verifier/state query values.
 */
export function redactDiagnostic(text: string): string {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/g, "[jwt]")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer [redacted]")
    .replace(
      /([?&#](?:code|state|code_verifier|access_token|id_token|refresh_token|client_secret)=)[^&#\s]+/gi,
      "$1[redacted]",
    );
}

/** Ordered, bounded, redacted step log that tells which function passed or failed and why. */
export class DiagnosticsLog {
  private readonly entries: DiagnosticEntry[] = [];

  constructor(
    private readonly onChange: (
      entries: readonly DiagnosticEntry[],
    ) => void = () => {},
    private readonly now: () => number = Date.now,
  ) {}

  record(
    step: string,
    status: DiagnosticStatus,
    detail?: unknown,
    durationMs?: number,
  ) {
    this.entries.push({
      at: new Date(this.now()).toISOString(),
      step,
      status,
      detail:
        detail === undefined
          ? undefined
          : redactDiagnostic(formatDetail(detail)),
      durationMs,
    });
    if (this.entries.length > MAX_ENTRIES)
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.onChange(this.entries);
  }

  /** Runs one function, records pass/fail with duration, and rethrows failures unchanged. */
  async step<T>(
    step: string,
    run: () => Promise<T> | T,
    describe?: (value: T) => unknown,
  ): Promise<T> {
    const started = this.now();
    try {
      const value = await run();
      this.record(step, "pass", describe?.(value), this.now() - started);
      return value;
    } catch (error) {
      this.record(step, "fail", describeError(error), this.now() - started);
      throw error;
    }
  }

  all(): readonly DiagnosticEntry[] {
    return this.entries;
  }

  clear() {
    this.entries.length = 0;
    this.onChange(this.entries);
  }

  toText(): string {
    return this.entries.map(formatEntry).join("\n");
  }
}

export function formatEntry(entry: DiagnosticEntry): string {
  const mark = { pass: "PASS", fail: "FAIL", skip: "SKIP", info: "INFO" }[
    entry.status
  ];
  const duration =
    entry.durationMs === undefined ? "" : ` (${entry.durationMs} ms)`;
  return `${entry.at} ${mark} ${entry.step}${duration}${entry.detail ? ` - ${entry.detail}` : ""}`;
}

export function describeError(error: unknown): string {
  if (!error) return "unknown error";
  const value = error as {
    name?: string;
    code?: string;
    status?: number;
    message?: string;
    correlationId?: string;
    debugInfo?: { code?: string; message?: string; errorLocation?: string };
  };
  const parts = [
    value.code && value.code !== value.message ? `code=${value.code}` : "",
    value.status ? `http=${value.status}` : "",
    value.message || String(error),
    value.debugInfo?.errorLocation ? `at=${value.debugInfo.errorLocation}` : "",
    value.correlationId ? `correlationId=${value.correlationId}` : "",
  ].filter(Boolean);
  return redactDiagnostic(parts.join(" "));
}

/**
 * Non-secret view of an Entra access token: claims only, never the token or its signature.
 * The payload is decoded for display; the backend remains the only validator.
 */
export function describeAccessToken(
  token: string,
  now: number = Date.now(),
):
  | {
      version?: string;
      tenantId?: string;
      objectId?: string;
      audience?: string;
      clientId?: string;
      scopes: string[];
      expiresInSeconds?: number;
    }
  | undefined {
  const payload = token.split(".")[1];
  if (!payload) return undefined;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const claims = JSON.parse(decodeBase64(padded)) as Record<string, unknown>;
    return {
      version: stringClaim(claims.ver),
      tenantId: stringClaim(claims.tid),
      objectId: stringClaim(claims.oid),
      audience: stringClaim(claims.aud),
      clientId: stringClaim(claims.azp) || stringClaim(claims.appid),
      scopes: (stringClaim(claims.scp) || "").split(" ").filter(Boolean),
      expiresInSeconds:
        typeof claims.exp === "number"
          ? Math.round(claims.exp - now / 1000)
          : undefined,
    };
  } catch {
    return undefined;
  }
}

const EXCEL_REQUIREMENT_SETS = ["1.1", "1.4", "1.7", "1.8", "1.9", "1.10"];

/** Office host facts and the Excel API sets each workbook action depends on. */
export function describeOfficeHost(office: any): Record<string, unknown> {
  const context = office?.context;
  if (!context) return { officeLoaded: Boolean(office), context: false };
  const supports = (name: string, version: string) => {
    try {
      return Boolean(context.requirements?.isSetSupported?.(name, version));
    } catch {
      return false;
    }
  };
  return {
    host: context.diagnostics?.host ?? office.HostType?.Excel ?? "unknown",
    platform: context.diagnostics?.platform ?? "unknown",
    version: context.diagnostics?.version ?? "unknown",
    excelApi: Object.fromEntries(
      EXCEL_REQUIREMENT_SETS.map((version) => [
        version,
        supports("ExcelApi", version),
      ]),
    ),
    dialogApi: supports("DialogApi", "1.1"),
  };
}

/** Minimum Excel API set for each action the add-in can apply. */
export const ACTION_REQUIREMENTS: Record<string, string> = {
  "new-sheet": "1.4",
  table: "1.4",
  chart: "1.4",
  "pivot-table": "1.8",
  clean: "1.4",
  "add-column": "1.4",
  "lookup-columns": "1.4",
  "split-column": "1.4",
  unpivot: "1.4",
  summary: "1.4",
  format: "1.6",
  quality: "1.4",
  statistics: "1.4",
  dashboard: "1.8",
  slicer: "1.10",
  view: "1.4",
  "export-csv": "1.4",
  "export-pdf": "1.1",
};

function stringClaim(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function formatDetail(detail: unknown): string {
  if (typeof detail === "string") return detail;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}
