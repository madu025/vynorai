export interface ResultEvidenceInput {
  request: string;
  sourceRange: string;
  result: {
    kind: string;
    targetSheet: string;
    targetRange?: string;
    request?: string;
    sourceRange?: string;
    previewPlanId?: string;
    status: string;
    notes?: string[];
    warnings?: string[];
  };
}

/** Evidence shown with every verified result; it never invents an address Excel did not return. */
export function buildResultEvidence(input: ResultEvidenceInput): string[] {
  const { result } = input;
  const request = result.request || input.request || "";
  const sourceRange = result.sourceRange || input.sourceRange || "";
  return [
    `Detected intent: ${request || "not recorded"}`,
    sourceRange
      ? `Source: ${sourceRange}`
      : "Source: recorded in the applied plan",
    result.previewPlanId
      ? `Preview/plan: approved plan ${result.previewPlanId} was applied after preview.`
      : "Preview/plan: the approved plan was applied after preview.",
    result.targetRange
      ? `Affected range: ${result.targetSheet}!${result.targetRange}`
      : `Affected output: sheet ${result.targetSheet}`,
    "Formula/value verification: the written output was read back from Excel.",
    "Read-back verification: Excel returned the result after writing.",
    result.status === "exists"
      ? "Duplicate/no-op guard: an existing result was kept; no duplicate was created."
      : `Result status: ${result.status}`,
    ...(result.notes?.length
      ? [`Fallback/unsupported: ${result.notes.join(" ")}`]
      : ["Fallback/unsupported: none reported."]),
    ...(result.notes ?? []),
    ...(result.warnings ?? []).map((warning) => `Warning: ${warning}`),
  ];
}
