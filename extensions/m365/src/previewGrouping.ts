/**
 * Which part of a plan "Summarize by", "Top-N" and "Sort order" in the preview card change.
 *
 * A PivotTable owns them. A plain chart that is drawn from the selected rows (no PivotTable behind
 * it) owns them too, so the same three controls work for a chart-only request. A histogram or a
 * waterfall draws raw values, a chart that draws a PivotTable takes the PivotTable's settings: for
 * those the controls are not offered, because the plan could not honour them.
 */

import type { ExcelAggregation, ExcelColumnSpecs } from "./excel.js";

export interface Grouping {
  aggregation: ExcelAggregation;
  topN?: number;
  lowest: boolean;
}

/** A chart that groups its own rows (not a histogram, a waterfall or a PivotTable result). */
function ownsGrouping(
  chart: ExcelColumnSpecs["chart"],
): chart is NonNullable<ExcelColumnSpecs["chart"]> {
  return (
    chart !== undefined &&
    chart.pivotResult !== true &&
    chart.chartType !== "histogram" &&
    chart.chartType !== "waterfall"
  );
}

/** True when the plan has something the grouping controls can change. */
export function canGroup(specs: ExcelColumnSpecs | undefined): boolean {
  return Boolean(specs?.pivot) || ownsGrouping(specs?.chart);
}

/** The settings the plan uses now (the PivotTable's when there is one, else the chart's). */
export function readGrouping(
  specs: ExcelColumnSpecs | undefined,
): Grouping | undefined {
  if (specs?.pivot)
    return {
      aggregation: specs.pivot.aggregation ?? "sum",
      ...(specs.pivot.topN ? { topN: specs.pivot.topN } : {}),
      lowest: specs.pivot.lowest === true,
    };
  if (specs && ownsGrouping(specs.chart))
    return {
      aggregation: specs.chart.aggregation ?? "sum",
      ...(specs.chart.topN ? { topN: specs.chart.topN } : {}),
      lowest: specs.chart.lowest === true,
    };
  return undefined;
}

export interface GroupingChange {
  aggregation?: ExcelAggregation;
  /** A number keeps that many groups; null shows all of them. */
  topN?: number | null;
  lowest?: boolean;
}

/**
 * Applies a change to the PivotTable and to a chart that groups its own rows, so a request for a
 * PivotTable and a chart together stays consistent. Mutates `specs` (the caller passes a copy).
 */
export function changeGrouping(
  specs: ExcelColumnSpecs,
  change: GroupingChange,
): void {
  const holders: Array<{
    aggregation?: ExcelAggregation;
    topN?: number;
    lowest?: boolean;
  }> = [];
  if (specs.pivot) holders.push(specs.pivot);
  if (ownsGrouping(specs.chart)) holders.push(specs.chart);
  for (const holder of holders) {
    if (change.aggregation) {
      // A chart's default is a sum, so the plan stays as it was before the control existed.
      if (change.aggregation === "sum" && holder === specs.chart)
        delete holder.aggregation;
      else holder.aggregation = change.aggregation;
    }
    if (change.topN === null) delete holder.topN;
    else if (change.topN !== undefined) holder.topN = change.topN;
    if (change.lowest !== undefined) holder.lowest = change.lowest;
  }
}
