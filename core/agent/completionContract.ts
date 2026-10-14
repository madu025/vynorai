import type {
  CompletionContractInput,
  CompletionScope,
  CriterionProvenance,
} from "./types";

/**
 * Turns the already-computed semantic scope into a bounded local draft. This
 * is deliberately deterministic: it does not make another model call and it
 * never treats the draft as passed evidence.
 */
export function draftCompletionContract(input: {
  scope: CompletionScope;
  confidence: number;
  impliedDeliverables: string[];
  now?: number;
}): CompletionContractInput {
  const seen = new Set<string>();
  const criteria = input.impliedDeliverables
    .map((value) =>
      String(value)
        .replace(/[\u0000-\u001f]+/g, " ")
        .trim()
        .slice(0, 160),
    )
    .filter(Boolean)
    .map((statement, index) => {
      const base =
        statement
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 48) || `outcome-${index + 1}`;
      let id = base;
      let suffix = 2;
      while (seen.has(id)) id = `${base}-${suffix++}`;
      seen.add(id);
      const policy =
        input.scope === "simple"
          ? // A simple task stays light-weight, but a bounded edit must still
            // consume the focused check the user requested (or use the
            // read-only inspection fallback when no mutation occurred).
            ["focused_check"]
          : input.scope === "medium"
            ? ["focused_check", "changed_surface"]
            : ["relevant_checks", "changed_surface", "independent_review"];
      const provenance: CriterionProvenance = "inferred";
      return {
        id,
        statement,
        provenance,
        required: true,
        evidencePolicy: policy,
        status: "pending" as const,
      };
    });
  if (criteria.length === 0) {
    criteria.push({
      id: "requested-outcome",
      statement: "The requested outcome is complete and verified.",
      provenance: "inferred",
      required: true,
      evidencePolicy: ["focused_check"],
      status: "pending",
    });
  }
  return {
    version: 1,
    scope: input.scope,
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    criteria: criteria.slice(0, 32),
  };
}
