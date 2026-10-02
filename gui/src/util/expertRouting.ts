export type ExpertRole =
  | "Architect"
  | "Engineer"
  | "Frontend"
  | "Backend"
  | "Database"
  | "Security"
  | "Performance"
  | "DevOps"
  | "QA";

const roleSignals: Array<[ExpertRole, RegExp]> = [
  [
    "Frontend",
    /\b(?:ui|ux|react|vue|angular|css|html|component|responsive|accessibility|a11y|webview)\b/i,
  ],
  [
    "Backend",
    /\b(?:backend|api|endpoint|server|service|proxy|router|websocket|stream|node|express|fastify)\b/i,
  ],
  [
    "Database",
    /\b(?:database|postgres(?:ql)?|mysql|sqlite|sql|schema|migration|query|redis|transaction|quota|ledger)\b/i,
  ],
  [
    "Security",
    /\b(?:security|secure|auth|oauth|jwt|secret|credential|permission|sandbox|quota|billing|payment|injection|vulnerab|race condition)\w*/i,
  ],
  [
    "Performance",
    /\b(?:performance|latency|throughput|concurren|scalab|memory|cpu|cache|optimi[sz]|token)\w*/i,
  ],
  [
    "DevOps",
    /\b(?:deploy|docker|kubernetes|k8s|ci\/cd|pipeline|coolify|cloud|terraform|server|production|rollback|observability)\b/i,
  ],
];

const mixedLanguageSignals: Array<[ExpertRole, RegExp]> = [
  ["Frontend", /(?:interface|screen|layout|auto width|ui eka)/i],
  ["Backend", /(?:api eka|server eka|backend eka)/i],
  ["Database", /(?:database eka|postgres|data migration)/i],
  ["Security", /(?:security|secur|araksha|permission)/i],
  ["Performance", /(?:ikman|slow|token save|concurrent)/i],
  ["DevOps", /(?:deploy|production|coolify)/i],
];

export function inferExpertRoles(request: string): ExpertRole[] {
  const roles: ExpertRole[] = ["Architect", "Engineer"];
  for (const [role, signal] of [...roleSignals, ...mixedLanguageSignals]) {
    if (signal.test(request) && !roles.includes(role)) roles.push(role);
  }
  roles.push("QA");
  return roles;
}

export function formatExpertRouting(roles: ExpertRole[]): string {
  const uniqueRoles = [...new Set(roles)];
  return `\nSelected specialist passes for this request: ${uniqueRoles.join(", ")}. Treat their reports as advisory evidence. Resolve conflicts against repository evidence and never invent findings.`;
}
