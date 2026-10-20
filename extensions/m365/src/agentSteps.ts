/**
 * The agent's `vynor_step` tool: one sentence through the add-in's own reader and builders (the same
 * path as a typed request: reader, local plan, server plan, plans must match, approval, apply,
 * audit receipt). `checkStep` runs only the local part, at once, so the agent can rephrase;
 * `runStep` runs the whole path after the person approved the agent's change list.
 */
import type { WorkbookPreferences } from "./preferences.js";
import type { M365ApiClient } from "./api.js";
import type { Language } from "./i18n.js";
import {
  adaptForSampledRange,
  createExcelPreviewPlan,
  excelPlansMatch,
  getExcelHeaderLayout,
  selectExcelActions,
} from "./excel.js";
import { interpretInstruction } from "./intent.js";
import {
  applyApprovedExcelPlan,
  rollbackItemsFromApplyReport,
  type ExcelRuntimeLike,
} from "./officeExcel.js";

type RangeInput = Parameters<typeof createExcelPreviewPlan>[0];

export function prepareStep(
  input: RangeInput,
  text: string,
):
  | { ok: true; actions: any[]; specs: any; preview: any }
  | { ok: false; error: string } {
  const layout = getExcelHeaderLayout(input as any);
  const interpreted: any = interpretInstruction(
    text,
    layout.headers,
    (input as any).values.slice(layout.headerRowCount),
  );
  if (interpreted.specs?.lookup || interpreted.specs?.lookupColumns)
    return {
      ok: false,
      error:
        "Lookups from another sheet: use write_formula with XLOOKUP instead.",
    };
  const wanted = [
    ...new Set([...selectExcelActions(text), ...interpreted.actions]),
  ].filter(
    (kind) => !(kind === "new-sheet" && interpreted.actions.includes("view")),
  );
  if (!wanted.length)
    return {
      ok: false,
      error:
        interpreted.problems?.[0] ?? "No action was found in the sentence.",
    };
  let actions: any[] = wanted;
  let specs = interpreted.specs ?? {};
  if ((input as any).sample) {
    const adapted = adaptForSampledRange(actions, specs);
    actions = adapted.actions;
    specs = adapted.specs;
  }
  try {
    const preview = createExcelPreviewPlan(input, actions, undefined, specs);
    return { ok: true, actions, specs, preview };
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message ?? error) };
  }
}

export function checkStepWith(readInput: () => Promise<RangeInput>) {
  return async (text: string) => {
    const prepared = prepareStep(await readInput(), text);
    return prepared.ok
      ? ({ ok: true, understood: prepared.actions.join(", ") } as const)
      : ({ ok: false, error: prepared.error } as const);
  };
}

export function runStepWith(deps: {
  runtime: ExcelRuntimeLike;
  api: M365ApiClient;
  readInput: () => Promise<RangeInput>;
  supportsExcelApi: (version: string) => boolean;
  requirements: Record<string, string>;
  /** Saved workbook preferences (currency, lakh grouping, audience) for dashboards. */
  preferences?: WorkbookPreferences;
  /** The person's language, for the words written on the sheet; the step text is the agent's. */
  language?: () => Language;
}) {
  return async (text: string) => {
    const input = await deps.readInput();
    const prepared = prepareStep(input, text);
    if (!prepared.ok)
      return { ok: false, detail: prepared.error, error: prepared.error };
    const plan = await deps.api.planExcel({
      ...input,
      actions: prepared.actions,
      ...(Object.keys(prepared.specs).length ? { specs: prepared.specs } : {}),
    });
    if (!excelPlansMatch(prepared.preview, plan))
      return {
        ok: false,
        detail: "plans differ",
        error: "The server plan did not match; nothing was applied.",
      };
    await deps.api.approveExcel({
      planId: plan.planId,
      sourceFingerprint: plan.sourceFingerprint,
      approvalToken: plan.approvalToken,
    });
    const report = await applyApprovedExcelPlan(
      deps.runtime,
      plan,
      true,
      plan.approvalToken,
      {
        expectedSourceFingerprint: prepared.preview.sourceFingerprint,
        supportsExcelApi: deps.supportsExcelApi,
        requirements: deps.requirements,
        // Read locally for business meaning (currency, target, audience); never sent anywhere.
        request: text,
        ...(deps.preferences ? { preferences: deps.preferences } : {}),
        ...(deps.language ? { language: deps.language() } : {}),
      },
    );
    const failed = report.results.filter(
      (result: any) => result.status === "failed",
    );
    await deps.api
      .reportExcelResult({
        planId: plan.planId,
        sourceFingerprint: plan.sourceFingerprint,
        approvalToken: plan.approvalToken,
        status: !report.sourceUnchangedAfterApply
          ? "source_verification_failed"
          : failed.length
            ? "partial_failure"
            : "applied",
        sourceUnchanged: report.sourceUnchangedAfterApply,
        results: report.results.map((result: any) => ({
          kind: result.kind,
          status: result.status,
        })),
      })
      .catch(() => undefined);
    return {
      ok: failed.length === 0,
      detail: report.results.map((result: any) => ({
        kind: result.kind,
        sheet: result.targetSheet,
        status: result.status,
        ...(result.error ? { error: String(result.error).slice(0, 160) } : {}),
        // Read-back differences and fallbacks, so the agent can tell the person or fix them.
        ...(result.warnings?.length
          ? {
              warnings: result.warnings
                .slice(0, 5)
                .map((text: string) => String(text).slice(0, 200)),
            }
          : {}),
        ...(result.notes?.length
          ? {
              notes: result.notes
                .slice(0, 5)
                .map((text: string) => String(text).slice(0, 240)),
            }
          : {}),
      })),
      rollback: rollbackItemsFromApplyReport(plan.planId, report.results),
      ...(failed.length
        ? { error: String(failed[0].error ?? "a step failed").slice(0, 200) }
        : {}),
    };
  };
}
