import { translate, type Language } from "./i18n.js";
import type { FormulaExplainView } from "./formulaExplainView.js";

const TEXT: Record<string, string> = {
  explain_many_cells: "Select a single cell that has a formula.",
  explain_no_formula: "This cell has no formula.",
  explain_too_long: "This formula is too long to explain here.",
  explain_error: "This formula could not be explained.",
  explain_read_failed: "The selected cell could not be read.",
  explain_cell: "Cell",
  explain_step: "Step",
  explain_whole: "Whole formula",
  explain_inputs: "Values read",
  explain_empty: "empty",
  explain_more: "{n} more steps not shown",
};

function text(language: Language, key: string): string {
  return translate(language, key, TEXT[key] ?? key);
}

/** Draws the explanation as a plain ordered list. Read-only: it only writes into `container`. */
export function renderFormulaExplain(
  document: Document,
  container: HTMLElement,
  view: FormulaExplainView | { kind: "read_failed" },
  language: Language,
): void {
  container.replaceChildren();
  const note = (key: string, detail?: string) => {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = text(language, key) + (detail ? ` ${detail}` : "");
    container.append(p);
  };
  switch (view.kind) {
    case "read_failed":
      return note("explain_read_failed");
    case "many_cells":
      return note("explain_many_cells");
    case "no_formula":
      return note("explain_no_formula");
    case "too_long":
      return note("explain_too_long");
    case "error":
      return note("explain_error", view.detail);
  }
  const heading = document.createElement("p");
  const strong = document.createElement("strong");
  strong.textContent = `${text(language, "explain_cell")} ${view.address}`;
  heading.append(strong);
  const list = document.createElement("ol");
  list.className = "explain-steps";
  const addRow = (row: (typeof view.rows)[number]) => {
    const item = document.createElement("li");
    item.value = row.number;
    const label = document.createElement("strong");
    label.textContent = row.isWhole
      ? text(language, "explain_whole")
      : `${text(language, "explain_step")} ${row.number}`;
    const code = document.createElement("code");
    code.textContent = row.expression;
    const meaning = document.createElement("span");
    meaning.textContent = row.meaning;
    item.append(label, code, meaning);
    if (row.inputs.length) {
      const inputs = document.createElement("small");
      inputs.textContent = `${text(language, "explain_inputs")}: ${row.inputs
        .map(
          (input) =>
            `${input.reference} = ${input.text ?? text(language, "explain_empty")}`,
        )
        .join("; ")}`;
      item.append(inputs);
    }
    list.append(item);
  };
  const last = view.rows.length - 1;
  view.rows.forEach((row, index) => {
    if (view.hiddenCount > 0 && index === last) {
      const more = document.createElement("li");
      more.className = "muted";
      more.textContent = text(language, "explain_more").replace(
        "{n}",
        String(view.hiddenCount),
      );
      list.append(more);
    }
    addRow(row);
  });
  container.append(heading, list);
}
