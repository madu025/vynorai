import type { AdvancedCapabilityReport } from "./capabilityRegistry.js";

/** Renders the capability contract without owning authentication or host state. */
export function renderCapabilityReport(
  document: Document,
  report: AdvancedCapabilityReport | undefined,
): void {
  const list = document.querySelector<HTMLElement>("#capability-report-list");
  if (!list) return;
  list.replaceChildren();
  if (!report) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Sign in and refresh capabilities to review this host.";
    list.append(empty);
    return;
  }
  const entries = Object.entries(report).sort(([a], [b]) => a.localeCompare(b));
  const counts = new Map<string, number>();
  for (const [, value] of entries)
    counts.set(value.status, (counts.get(value.status) ?? 0) + 1);
  for (const [feature, value] of entries) {
    const row = document.createElement("div");
    row.className = "capability-row";
    const body = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = feature.replaceAll("-", " ");
    body.append(title);
    const detail = document.createElement("small");
    const requirements = [
      value.requirement?.hosts?.length
        ? `Hosts: ${value.requirement.hosts.join(", ")}`
        : "",
      value.requirement?.excelApi
        ? `ExcelApi ${value.requirement.excelApi}`
        : "",
      value.fallbackFeature
        ? `Fallback: ${value.fallbackFeature.replaceAll("-", " ")}`
        : "",
      value.reason ?? "",
    ].filter(Boolean);
    detail.textContent = requirements.join(" · ") || "No extra requirements.";
    body.append(detail);
    const status = document.createElement("span");
    status.className = "capability-status";
    status.dataset.status = value.status;
    status.textContent = value.status.replaceAll("_", " ");
    row.append(body, status);
    list.append(row);
  }
  const summary = document.querySelector<HTMLElement>("#capabilities-summary");
  if (summary)
    summary.textContent = `${entries.length} features checked · ${counts.get("available") ?? 0} available · ${counts.get("available_with_fallback") ?? 0} with fallback · ${counts.get("consent_required") ?? 0} needing approval · ${counts.get("unsupported") ?? 0} unavailable.`;
}
