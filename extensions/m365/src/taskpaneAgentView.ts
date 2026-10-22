import type { AnswerSource } from "./agent.js";

export const AGENT_STAGES = [
  "inspect",
  "plan",
  "review",
  "approval",
  "apply",
  "verify",
] as const;

export type AgentStage = (typeof AGENT_STAGES)[number];

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
        item.textContent =
          source.kind === "formula"
            ? `Excel computed ${source.text}`
            : `Workbook check: ${source.text.replace(/_/g, " ")}`;
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
