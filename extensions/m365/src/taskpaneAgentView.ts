import type { AgentMessage, AnswerSource } from "./agent.js";
import type { RelationLink } from "./relationships.js";

export const AGENT_STAGES = [
  "inspect",
  "plan",
  "preview",
  "review",
  "approval",
  "apply",
  "verify",
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];
export type AgentRole =
  | "planner"
  | "relationships"
  | "builder"
  | "accuracy"
  | "safety"
  | "verification";

let localize: (text: string) => string = (text) => text;
/** The pane hands over its language once; role statuses are written here as plain English. */
export function setAgentViewLocalizer(fn: (text: string) => string): void {
  localize = fn;
}

/**
 * Run-time text is written in English and localized when it is shown. The English stays on the element,
 * so switching the language while the agent card is open can write the same text again in the new one.
 */
export function setLocalizedText(element: HTMLElement, english: string): void {
  element.dataset.en = english;
  delete element.dataset.enParts;
  element.textContent = localize(english);
}

/** A line made of several English parts, each localized on its own and joined with a space. */
export function setLocalizedParts(element: HTMLElement, parts: readonly string[]): void {
  delete element.dataset.en;
  element.dataset.enParts = JSON.stringify(parts);
  element.textContent = parts.map(localize).join(" ");
}

/** Writes every text set with `setLocalizedText` / `setLocalizedParts` again in the current language. */
export function relocalizeView(root: ParentNode): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-en]"))
    element.textContent = localize(element.dataset.en ?? "");
  for (const element of root.querySelectorAll<HTMLElement>("[data-en-parts]")) {
    let parts: unknown;
    try {
      parts = JSON.parse(element.dataset.enParts ?? "[]");
    } catch {
      parts = [];
    }
    element.textContent = Array.isArray(parts) ? parts.map((part) => localize(String(part))).join(" ") : "";
  }
  // A role name cut short by a narrow pane shows in full as its title: keep it in the current language.
  for (const name of root.querySelectorAll<HTMLElement>("#agent-activity-list [data-agent-role] strong"))
    name.title = name.textContent ?? "";
}

export function setAgentRoleView(
  document: Document,
  role: AgentRole,
  state: "pending" | "active" | "done" | "skipped",
  evidence?: string,
): void {
  const row = document.querySelector<HTMLElement>(
    `#agent-activity-list [data-agent-role="${role}"]`,
  );
  if (!row) return;
  row.dataset.state = state;
  const status = row.querySelector<HTMLElement>(".agent-role-status");
  if (status) setLocalizedText(status, evidence || state);
  // A name cut short by a narrow pane still shows in full on hover and to assistive technology.
  const name = row.querySelector<HTMLElement>("strong");
  if (name) name.title = name.textContent ?? "";
}

/**
 * After a request ends without finishing its work (an error or Stop), a role still "active" ends as
 * skipped with the reason, never spinning, and one that never started ends as skipped too: no role
 * keeps saying "pending" for a request that is over.
 */
export function settleActiveRolesView(document: Document, evidence: string): void {
  for (const row of document.querySelectorAll<HTMLElement>(
    "#agent-activity-list [data-agent-role]",
  ))
    if (row.dataset.state === "active" || row.dataset.state === "pending")
      setAgentRoleView(document, row.dataset.agentRole as AgentRole, "skipped", evidence);
}

export function resetAgentRolesView(document: Document): void {
  for (const row of document.querySelectorAll<HTMLElement>(
    "#agent-activity-list [data-agent-role]",
  )) {
    row.dataset.state = "pending";
    const status = row.querySelector<HTMLElement>(".agent-role-status");
    if (status) setLocalizedText(status, "pending");
  }
}

export function setAgentStageView(
  document: Document,
  stage: AgentStage,
  complete = false,
): void {
  const current = AGENT_STAGES.indexOf(stage);
  for (const item of document.querySelectorAll<HTMLElement>(
    "#agent-timeline [data-stage]",
  )) {
    const index = AGENT_STAGES.indexOf(item.dataset.stage as AgentStage);
    item.classList.toggle(
      "done",
      index < current || (complete && index === current),
    );
    item.classList.toggle("active", !complete && index === current);
  }
}

export function agentToolLabel(
  name: string,
  args: Record<string, unknown>,
): string {
  switch (name) {
    case "get_workbook":
      return "Looking at the workbook";
    case "read_range":
      return `Reading ${String(args.sheet ?? "")}!${String(args.address ?? "")}`;
    case "calculate":
      return `Calculating ${String(args.formula ?? "").slice(0, 80)}`;
    case "run_code":
      return `Running analysis code on ${String(args.sheet ?? "")}!${String(args.address ?? "")} (on this device, no network)`;
    case "vynor_step":
      return `Checking a step: ${String(args.instruction ?? "").slice(0, 80)}`;
    default:
      return `Preparing a change (${name})`;
  }
}

export function showAgentPlanView(
  document: Document,
  steps: readonly string[],
): void {
  const plan = document.querySelector<HTMLElement>("#agent-plan");
  const planSteps = document.querySelector<HTMLElement>("#agent-plan-steps");
  if (!plan || !planSteps) return;
  planSteps.replaceChildren(
    ...steps.map((step) => {
      const item = document.createElement("li");
      item.textContent = step;
      return item;
    }),
  );
  plan.hidden = steps.length === 0;
}

export function showAgentSourcesView(options: {
  document: Document;
  sources: readonly AnswerSource[];
  selectRange(sheet: string, address: string): Promise<void>;
  recordError(error: unknown): void;
}): void {
  const { document, sources, selectRange, recordError } = options;
  const card = document.querySelector<HTMLElement>("#agent-sources");
  const list = document.querySelector<HTMLElement>("#agent-sources-list");
  if (!card || !list) return;
  list.replaceChildren(
    ...sources.map((source) => {
      const item = document.createElement("li");
      if (source.kind !== "range") {
        if (source.kind === "formula") {
          // A long formula is one line of text in a card; the whole formula opens on demand.
          const details = document.createElement("details");
          const summary = document.createElement("summary");
          summary.textContent = `${localize("Excel computed")}: ${source.text.length > 48 ? `${source.text.slice(0, 48)}…` : source.text}`;
          const code = document.createElement("code");
          code.textContent = source.text;
          details.append(summary, code);
          item.append(details);
        } else
          setLocalizedText(item, `Workbook check: ${source.text.replace(/_/g, " ")}`);
        return item;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "link";
      button.textContent = `'${source.sheet}'!${source.address}${source.note ? ` (${source.note.replace(/_/g, " ")})` : ""}`;
      button.addEventListener("click", () => {
        void selectRange(source.sheet, source.address).catch(recordError);
      });
      item.append(button);
      return item;
    }),
  );
  card.hidden = sources.length === 0;
}

export function relationshipEvidence(
  messages: readonly AgentMessage[],
): RelationLink | undefined {
  const calls = new Set<string>();
  for (const message of messages)
    if (message.role === "assistant")
      for (const call of message.tool_calls ?? [])
        if (call.function.name === "map_relationships") calls.add(call.id);
  for (const message of messages) {
    if (message.role !== "tool" || !calls.has(message.tool_call_id)) continue;
    try {
      const value = JSON.parse(message.content) as { links?: RelationLink[] };
      if (Array.isArray(value.links) && value.links[0]) return value.links[0];
    } catch {
      // A clipped or malformed result is not relationship evidence.
    }
  }
  return undefined;
}

export function showWorkbookMapView(
  document: Document,
  link: RelationLink | undefined,
): void {
  const card = document.querySelector<HTMLElement>("#workbook-map");
  const content = document.querySelector<HTMLElement>("#workbook-map-content");
  if (!card || !content) return;
  content.replaceChildren();
  card.hidden = !link;
  if (!link) return;
  const node = (side: RelationLink["from"]) => {
    const box = document.createElement("div");
    box.className = "relationship-node";
    const table = document.createElement("strong");
    table.textContent = side.table.split("!")[0];
    table.title = side.table.split("!")[0];
    const column = document.createElement("span");
    column.textContent = side.column;
    column.title = side.column;
    box.append(table, column);
    return box;
  };
  const line = document.createElement("div");
  line.className = "relationship-line";
  line.textContent = `${localize(link.cardinality)} →`;
  const graph = document.createElement("div");
  graph.className = "relationship-graph";
  graph.append(node(link.from), line, node(link.to));
  const facts = document.createElement("div");
  facts.className = "relationship-facts";
  for (const text of [
    `${link.fromRowsWithoutPartner.toLocaleString("en-US")} unmatched rows`,
    `${(link.from.duplicateKeys + link.to.duplicateKeys).toLocaleString("en-US")} duplicate keys`,
    link.needsCleaning ? "Clean keys first" : "Keys are consistent",
  ]) {
    const badge = document.createElement("span");
    badge.textContent = localize(text);
    facts.appendChild(badge);
  }
  content.append(graph, facts);
}
