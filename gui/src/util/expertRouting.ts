export type ExpertRole =
  | "Architect"
  | "Engineer"
  | "Frontend"
  | "Database"
  | "Security"
  | "DevOps"
  | "QA";

const roleSignals: Array<[ExpertRole, RegExp]> = [
  ["Frontend", /\b(?:ui|ux|react|vue|angular|css|html|component|responsive|accessibility|a11y)\b/i],
  ["Database", /\b(?:database|postgres(?:ql)?|mysql|sqlite|sql|schema|migration|query|redis|transaction)\b/i],
  ["Security", /\b(?:security|auth|oauth|jwt|secret|credential|permission|quota|billing|payment|injection|vulnerab)\w*/i],
  ["DevOps", /\b(?:deploy|docker|kubernetes|k8s|ci\/cd|pipeline|coolify|cloud|terraform|server|production)\b/i],
];

export function inferExpertRoles(request: string): ExpertRole[] {
  const roles: ExpertRole[] = ["Architect", "Engineer"];
  for (const [role, signal] of roleSignals) {
    if (signal.test(request)) roles.push(role);
  }
  roles.push("QA");
  return roles;
}

export function formatExpertRouting(roles: ExpertRole[]): string {
  const uniqueRoles = [...new Set(roles)];
  return `\nSelected specialist passes for this request: ${uniqueRoles.join(", ")}. Keep each pass focused and do not invent findings.`;
}
