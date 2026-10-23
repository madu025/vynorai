import type { AgentMessage, AnswerSource, StagedChange } from "./agent.js";
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
export function setLocalizedParts(
  element: HTMLElement,
  parts: readonly string[],
): void {
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
    element.textContent = Array.isArray(parts)
      ? parts.map((part) => localize(String(part))).join(" ")
      : "";
  }
  // A role name cut short by a narrow pane shows in full as its title: keep it in the current language.
  for (const name of root.querySelectorAll<HTMLElement>(
    "#agent-activity-list [data-agent-role] strong",
  ))
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
export function settleActiveRolesView(
  document: Document,
  evidence: string,
): void {
  for (const row of document.querySelectorAll<HTMLElement>(
    "#agent-activity-list [data-agent-role]",
  ))
    if (row.dataset.state === "active" || row.dataset.state === "pending")
      setAgentRoleView(
        document,
        row.dataset.agentRole as AgentRole,
        "skipped",
        evidence,
      );
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
  // Plain words only: no formulas, ranges or tool names in the live line.
  switch (name) {
    case "get_workbook":
      return "Reading workbook";
    case "read_range":
      return `Reading ${String(args.sheet ?? "").trim() || "data"}`;
    case "calculate":
      return "Calculating…";
    case "run_code":
      return `Analysing ${String(args.sheet ?? "").trim() || "data"}`;
    case "vynor_step":
      return "Checking a step";
    default:
      return "Preparing a change";
  }
}

/** First plan steps shown before "Show all N steps". */
export const PLAN_STEPS_SHOWN = 3;

/** "'Sheet'!A1:B2" or "Sheet!A1" in a step; the first one found. */
export function stepRange(
  step: string,
): { sheet: string; address: string } | undefined {
  const m =
    /(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/.exec(
      step,
    );
  if (!m) return undefined;
  return { sheet: (m[1] ?? m[2]).replace(/''/g, "'"), address: m[3] };
}

/** Removes every call such as LET(...), balanced to its closing bracket, and the "=" that leads it. */
export function stripFormulaText(text: string): string {
  let out = text;
  for (let guard = 0; guard < 20; guard++) {
    const start = /=?\s*\b[A-Z][A-Z0-9.]{1,}\(/.exec(out);
    if (!start) break;
    let depth = 0;
    let end = -1;
    for (let i = start.index + start[0].length - 1; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out = out.slice(0, start.index) + (end < 0 ? "" : out.slice(end));
  }
  return out.replace(/\s{2,}/g, " ").replace(/\s+([,.;:])/g, "$1");
}

/** A step for display: ranges and addresses removed, the full text stays in the title. */
export function plainStep(step: string): string {
  return (
    stripFormulaText(step)
      .replace(
        /\s*(?:'(?:[^']|'')+'|[A-Za-z_][\w.]*)!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g,
        "",
      )
      // Tool names the planner copied into a step ("write_formula") read as plain words.
      .replace(/\b[a-z]+(?:_[a-z]+)+\b/g, (name) => name.replace(/_/g, " "))
      .replace(/\s{2,}/g, " ")
      .trim()
      .replace(/^[a-z]/, (letter) => letter.toUpperCase())
  );
}

/** First changes shown before "Show all N changes". */
export const CHANGES_SHOWN = 3;

/**
 * An applied change for display: the sheet name stays, ranges and formulas go.
 * "Write in 'Sales Summary'!A10: =LET(...)" reads "Write in Sales Summary".
 */
export function shortResult(text: string): string {
  return text
    .replace(
      /(?:'((?:[^']|'')+)'|([A-Za-z_][\w.]*))!\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?/g,
      (_all, quoted: string | undefined, plain: string | undefined) =>
        (quoted ?? plain ?? "").replace(/''/g, "'"),
    )
    .replace(/:?\s*=.*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * After an apply, only the first CHANGES_SHOWN lines (and every failed one) stay visible; the rest
 * wait behind "Show all N changes". The full text of each line stays in its title.
 */
export function collapseAppliedList(
  document: Document,
  list: HTMLElement,
  shown: number = CHANGES_SHOWN,
): void {
  const items = [...list.querySelectorAll<HTMLElement>(":scope > li")];
  const hideable = items.filter(
    (li, index) => index >= shown && li.dataset.status !== "failed",
  );
  if (!hideable.length) return;
  hideable.forEach((li) => {
    li.hidden = true;
  });
  const more = document.createElement("button");
  more.type = "button";
  more.id = "agent-changes-more";
  more.className = "link";
  more.setAttribute("aria-expanded", "false");
  more.setAttribute("aria-controls", list.id || "agent-changes");
  const closed = `Show all ${items.length} changes`;
  more.textContent = closed;
  more.addEventListener("click", () => {
    const open = more.getAttribute("aria-expanded") !== "true";
    more.setAttribute("aria-expanded", String(open));
    more.textContent = open ? "Show fewer changes" : closed;
    hideable.forEach((li) => {
      li.hidden = !open;
    });
  });
  list.after(more);
}

/** A short plain description of a staged change; formulas and ranges stay in the full text. */
export function shortChange(change: StagedChange, full: string): string {
  switch (change.kind) {
    case "create_sheet":
      return `Create sheet ${change.name}`;
    case "write_formula":
      return change.fillRange || change.header
        ? `Fill the ${change.sheet} table`
        : `Write a formula in ${change.sheet}`;
    case "write_values":
      return `Write values in ${change.sheet}`;
    case "create_chart":
      return `Add a ${change.chartType} chart`;
    case "sort_range":
      return `Sort ${change.sheet} by ${change.column}`;
    case "format_range":
      return change.bold && !change.numberFormat
        ? "Format the header"
        : change.numberFormat
          ? "Format the numbers"
          : `Format ${change.sheet}`;
    case "vynor_step":
      return change.instruction;
    default:
      return plainStep(full) || full;
  }
}

/**
 * The approval list: one short line per change, the full text (formulas, ranges) in the title and in
 * a collapsed Details, and the first CHANGES_SHOWN changes visible with a toggle for the rest. All
 * text stays in the page. Later additions (the before/after tables) are appended to each item.
 */
export function showChangeList(
  document: Document,
  list: HTMLElement,
  changes: readonly StagedChange[],
  describe: (change: StagedChange) => string,
  write: (element: HTMLElement, text: string) => void = (element, text) => {
    element.textContent = text;
  },
): void {
  list.parentElement?.querySelector("#agent-changes-more")?.remove();
  list.replaceChildren(
    ...changes.map((change, index) => {
      const full = describe(change);
      const li = document.createElement("li");
      const line = document.createElement("span");
      write(line, shortChange(change, full));
      li.title = full;
      li.append(line);
      const details = document.createElement("details");
      details.className = "change-full";
      const summary = document.createElement("summary");
      summary.textContent = "Details";
      const text = document.createElement("p");
      write(text, full);
      details.append(summary, text);
      li.append(details);
      if (index >= CHANGES_SHOWN) li.hidden = true;
      return li;
    }),
  );
  if (changes.length > CHANGES_SHOWN) {
    const more = document.createElement("button");
    more.type = "button";
    more.id = "agent-changes-more";
    more.className = "link";
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", list.id || "agent-changes");
    more.textContent = `Show all ${changes.length} changes`;
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open
        ? "Show fewer changes"
        : `Show all ${changes.length} changes`;
      list.querySelectorAll<HTMLElement>(":scope > li").forEach((li, i) => {
        if (i >= CHANGES_SHOWN) li.hidden = !open;
      });
    });
    list.after(more);
  }
}

export function showAgentPlanView(
  document: Document,
  steps: readonly string[],
  selectRange?: (sheet: string, address: string) => Promise<void>,
): void {
  const plan = document.querySelector<HTMLElement>("#agent-plan");
  const planSteps = document.querySelector<HTMLElement>("#agent-plan-steps");
  if (!plan || !planSteps) return;
  planSteps.replaceChildren(
    ...steps.map((step, index) => {
      const item = document.createElement("li");
      item.textContent = plainStep(step) || step;
      item.title = step;
      const range = stepRange(step);
      if (range && selectRange) {
        item.tabIndex = 0;
        item.className = "plan-step-link";
        const go = () => {
          void selectRange(range.sheet, range.address).catch(() => undefined);
        };
        item.addEventListener("click", go);
        item.addEventListener("keydown", (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            go();
          }
        });
      }
      if (index >= PLAN_STEPS_SHOWN) item.hidden = true;
      return item;
    }),
  );
  planSteps.parentElement
    ?.querySelector<HTMLElement>("#agent-plan-more")
    ?.remove();
  if (steps.length > PLAN_STEPS_SHOWN) {
    const more = document.createElement("button");
    more.type = "button";
    more.id = "agent-plan-more";
    more.className = "link";
    more.setAttribute("aria-expanded", "false");
    more.setAttribute("aria-controls", "agent-plan-steps");
    more.textContent = `Show all ${steps.length} steps`;
    more.addEventListener("click", () => {
      const open = more.getAttribute("aria-expanded") !== "true";
      more.setAttribute("aria-expanded", String(open));
      more.textContent = open
        ? "Show fewer steps"
        : `Show all ${steps.length} steps`;
      planSteps.querySelectorAll<HTMLElement>("li").forEach((li, i) => {
        if (i >= PLAN_STEPS_SHOWN) li.hidden = !open;
      });
    });
    planSteps.after(more);
  }
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
          summary.textContent = localize("Calculation");
          summary.title = source.text;
          const code = document.createElement("code");
          code.textContent = source.text;
          details.append(summary, code);
          item.append(details);
        } else
          setLocalizedText(
            item,
            `Workbook check: ${source.text.replace(/_/g, " ")}`,
          );
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
