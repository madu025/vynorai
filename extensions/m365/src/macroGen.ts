/**
 * Office Script and VBA generation from one plain sentence ("write a VBA macro that sorts by Sales").
 * Deterministic: a closed set of recipes, filled with column names that exist in the selection. The
 * add-in never runs the code; the person copies it into Excel's Automate tab or the VBA editor.
 * Anything outside the recipes fails closed and names what is supported, so nothing is invented.
 */
export type MacroLanguage = "office-script" | "vba";

export type MacroResult =
  | {
      ok: true;
      language: MacroLanguage;
      title: string;
      code: string;
      /** What the code does, one line per recipe. */
      steps: string[];
      /** Honest limits the person must know before running it. */
      notes: string[];
    }
  | { ok: false; problem: string };

export const MACRO_RECIPES = [
  "sort by a column",
  "add a Total column (row sums)",
  "freeze the header row",
  "autofit the columns",
  "remove duplicate rows",
  "turn on filter buttons",
  "bold and shade the header",
  "delete blank rows",
  "highlight cells where a column is greater than, less than or equal to a number",
  "create a PivotTable of a column by another column",
] as const;

const REQUEST =
  /\b(?:write|create|generate|make|give|build|record)\b.*\b(office\s*scripts?|excel\s*scripts?|vba|macros?|scripts?)\b/i;
const NOUN = /\b(office\s*scripts?|excel\s*scripts?|vba|macros?|scripts?)\b/i;

/** The language a request asks for, or undefined when it is not a code request. */
export function detectMacroRequest(
  instruction: string,
): MacroLanguage | undefined {
  if (!REQUEST.test(instruction)) return undefined;
  const noun = NOUN.exec(instruction)?.[1].toLowerCase() ?? "";
  return /vba|macro/.test(noun) ? "vba" : "office-script";
}

type Recipe =
  | { kind: "sort"; header: string; descending: boolean; defaulted: boolean }
  | { kind: "total"; name: string; sources: string[] }
  | { kind: "freeze" }
  | { kind: "autofit" }
  | { kind: "dedupe" }
  | { kind: "filter" }
  | { kind: "header-style" }
  | { kind: "blank-rows" }
  | {
      kind: "highlight";
      header: string;
      operator: "GreaterThan" | "LessThan" | "EqualTo";
      value: number;
    }
  | { kind: "pivot"; rows: string; values: string };

const OPERATORS: Array<[RegExp, "GreaterThan" | "LessThan" | "EqualTo"]> = [
  [
    /\b(?:greater than|more than|bigger than|higher than|over|above|exceeds?)\b|>/i,
    "GreaterThan",
  ],
  [
    /\b(?:less than|smaller than|lower than|under|below|fewer than)\b|</i,
    "LessThan",
  ],
  [/\b(?:equal to|equals?|is exactly)\b|=/i, "EqualTo"],
];

const DESCENDING =
  /\b(descending|desc|z-a|largest|biggest|highest|high to low|newest|latest)\b/i;

const isNumberColumn = (rows: unknown[][], index: number) =>
  rows.some((row) => typeof row[index] === "number") &&
  rows.every(
    (row) =>
      row[index] === null ||
      row[index] === undefined ||
      row[index] === "" ||
      typeof row[index] === "number",
  );

const NOT_AN_AMOUNT =
  /\b(date|time|day|month|year|id|code|no|number|phone|zip|postcode|percent|rate)\b|%/i;

/** A numeric column worth adding up: not a date serial, identifier, code or rate. */
function isAmount(header: string, rows: unknown[][], index: number): boolean {
  if (NOT_AN_AMOUNT.test(header)) return false;
  const numbers = rows
    .map((row) => row[index])
    .filter((value): value is number => typeof value === "number");
  // Whole numbers between 1900 and 2100 as Excel date serials (25569..73415) are dates, not amounts.
  const looksLikeDates =
    numbers.length > 0 &&
    numbers.every(
      (value) => Number.isInteger(value) && value >= 25569 && value <= 73415,
    );
  return !looksLikeDates;
}

/** Longest header the text mentions, so "Sales Cost" wins over "Sales". */
function mentionedHeader(headers: string[], text: string): string | undefined {
  const lower = text.toLocaleLowerCase();
  return headers
    .filter((header) => header && lower.includes(header.toLocaleLowerCase()))
    .sort((left, right) => right.length - left.length)[0];
}

function readRecipes(
  task: string,
  headers: string[],
  rows: unknown[][],
): { recipes: Recipe[]; problem?: string } {
  const recipes: Recipe[] = [];

  if (/\bsort/i.test(task)) {
    const afterBy = /\bsort\w*\b.*?\bby\s+(.+)$/i.exec(task)?.[1] ?? "";
    const header = mentionedHeader(headers, afterBy);
    if (/\bby\b/i.test(task) && afterBy && !header)
      return {
        recipes,
        problem: `I could not find the column to sort by. The columns are: ${headers.filter(Boolean).join(", ")}.`,
      };
    const target = header ?? headers.find(Boolean);
    if (!target)
      return { recipes, problem: "The selection has no header row." };
    recipes.push({
      kind: "sort",
      header: target,
      descending: DESCENDING.test(afterBy || task),
      defaulted: !header,
    });
  }

  const addColumn =
    /\b(?:add|adds|insert|inserts|create|creates)\s+(?:a|an|the)?\s*"?([\w][\w ]{0,29}?)"?\s+column\b/i.exec(
      task,
    );
  if (addColumn) {
    const name = addColumn[1].trim();
    if (!/^(total|sum|grand total|row total)$/i.test(name))
      return {
        recipes,
        problem: `I can write a Total (row sum) column. A "${name}" column needs a rule I cannot guess; describe it as a computed column in the pane instead.`,
      };
    const sources = headers.filter(
      (header, index) =>
        header && isNumberColumn(rows, index) && isAmount(header, rows, index),
    );
    if (!sources.length)
      return {
        recipes,
        problem: "There is no numeric column in the selection to add up.",
      };
    recipes.push({ kind: "total", name: "Total", sources });
  }

  if (/\bfreez\w*\b/i.test(task)) recipes.push({ kind: "freeze" });
  if (/\bauto-?\s?fit\b|\bfit (?:the )?columns?\b/i.test(task))
    recipes.push({ kind: "autofit" });
  if (
    /\b(?:remov|delet|drop)\w*\b.*\bduplicates?\b|\bdedupe\b|\bdistinct\b/i.test(
      task,
    )
  )
    recipes.push({ kind: "dedupe" });
  if (/\bfilter (?:buttons?|arrows?|dropdowns?)\b|\bauto-?filter\b/i.test(task))
    recipes.push({ kind: "filter" });
  if (
    /\b(?:bold|shad|styl|colou?r)\w*\b.*\bheaders?\b|\bheaders?\b.*\b(?:bold|shaded|styled)\b/i.test(
      task,
    )
  )
    recipes.push({ kind: "header-style" });

  if (
    /\b(?:delet|remov|drop|clear)\w*\s+(?:all\s+|the\s+)?(?:blank|empty)\s+(?:rows?|lines?)\b/i.test(
      task,
    )
  )
    recipes.push({ kind: "blank-rows" });

  if (/\bhighlight\w*\b/i.test(task)) {
    const header = mentionedHeader(headers, task);
    const operator = OPERATORS.find(([pattern]) => pattern.test(task))?.[1];
    const number = /(-?\d+(?:\.\d+)?)\s*[.!?]?\s*$/.exec(task.trim())?.[1];
    if (!header || !operator || number === undefined)
      return {
        recipes,
        problem: `To highlight I need a column, a comparison and a number, for example "highlight Sales greater than 100". The columns are: ${headers.filter(Boolean).join(", ")}.`,
      };
    const index = headers.indexOf(header);
    if (!isNumberColumn(rows, index))
      return {
        recipes,
        problem: `"${header}" is not a number column, so a greater-than or less-than rule would be wrong. I can highlight number columns only.`,
      };
    recipes.push({
      kind: "highlight",
      header,
      operator,
      value: Number(number),
    });
  }

  const pivot =
    /\bpivot\w*(?:\s*tables?)?\s+(?:of|for|showing|with)?\s*(.+?)\s+by\s+(.+?)\s*[.!?]?$/i.exec(
      task,
    );
  if (pivot) {
    const values = mentionedHeader(headers, pivot[1]);
    const rowHeader = mentionedHeader(headers, pivot[2]);
    if (!values || !rowHeader || values === rowHeader)
      return {
        recipes,
        problem: `For a PivotTable I need two different columns, for example "create a PivotTable of Sales by Region". The columns are: ${headers.filter(Boolean).join(", ")}.`,
      };
    if (!isNumberColumn(rows, headers.indexOf(values)))
      return {
        recipes,
        problem: `"${values}" is not a number column, so it cannot be summed in a PivotTable.`,
      };
    recipes.push({ kind: "pivot", rows: rowHeader, values });
  }

  if (!recipes.length)
    return {
      recipes,
      problem: `I can write code for: ${MACRO_RECIPES.join("; ")}. Say which, for example "write an Office Script that sorts by Sales and freezes the header".`,
    };
  return { recipes };
}

const js = (value: string) => JSON.stringify(value);
const vba = (value: string) => `"${value.replace(/"/g, '""')}"`;
const safeName = (value: string) => !/[\r\n]/.test(value);

function officeScript(recipes: Recipe[]): string {
  const lines: string[] = [
    "function main(workbook: ExcelScript.Workbook) {",
    "  const sheet = workbook.getActiveWorksheet();",
    "  const used = sheet.getUsedRange();",
    '  if (!used) throw new Error("The sheet is empty.");',
    "  const headers = used.getValues()[0].map((cell) => String(cell));",
    "  const column = (name: string) => {",
    "    const index = headers.indexOf(name);",
    '    if (index < 0) throw new Error(`Column "${name}" was not found in the header row.`);',
    "    return index;",
    "  };",
  ];
  lines.push("  let range = used;");
  for (const recipe of recipes) {
    if (recipe.kind === "total") {
      lines.push(
        `  const sumColumns = [${recipe.sources.map(js).join(", ")}].map(column);`,
        `  if (headers.includes(${js(recipe.name)})) throw new Error("A ${recipe.name} column already exists.");`,
        "  const rowCount = used.getRowCount();",
        "  const firstRow = used.getRowIndex();",
        "  const firstColumn = used.getColumnIndex();",
        "  const targetColumn = firstColumn + used.getColumnCount();",
        `  sheet.getRangeByIndexes(firstRow, targetColumn, 1, 1).setValue(${js(recipe.name)});`,
        "  const formulas: string[][] = [];",
        "  for (let row = 1; row < rowCount; row += 1) {",
        '    const cells = sumColumns.map((index) => used.getCell(row, index).getAddress().split("!").pop());',
        '    formulas.push([`=SUM(${cells.join(",")})`]);',
        "  }",
        "  if (formulas.length) sheet.getRangeByIndexes(firstRow + 1, targetColumn, formulas.length, 1).setFormulas(formulas);",
        "  range = sheet.getUsedRange();",
      );
    } else if (recipe.kind === "sort") {
      lines.push(
        `  range.getSort().apply([{ key: column(${js(recipe.header)}), ascending: ${!recipe.descending} }], false, true);`,
      );
    } else if (recipe.kind === "freeze") {
      lines.push("  sheet.getFreezePanes().freezeRows(1);");
    } else if (recipe.kind === "autofit") {
      lines.push("  range.getFormat().autofitColumns();");
    } else if (recipe.kind === "dedupe") {
      lines.push(
        "  range.removeDuplicates(headers.map((_, index) => index), true);",
      );
    } else if (recipe.kind === "filter") {
      lines.push("  sheet.getAutoFilter().apply(range);");
    } else if (recipe.kind === "blank-rows") {
      lines.push(
        "  {",
        "    const values = range.getValues();",
        "    const top = range.getRowIndex();",
        "    const left = range.getColumnIndex();",
        "    const width = range.getColumnCount();",
        "    for (let row = values.length - 1; row >= 1; row -= 1) {",
        '      if (values[row].every((cell) => cell === "")) sheet.getRangeByIndexes(top + row, left, 1, width).delete(ExcelScript.DeleteShiftDirection.up);',
        "    }",
        "    range = sheet.getUsedRange();",
        "  }",
      );
    } else if (recipe.kind === "highlight") {
      lines.push(
        "  {",
        `    const target = sheet.getRangeByIndexes(range.getRowIndex() + 1, range.getColumnIndex() + column(${js(recipe.header)}), range.getRowCount() - 1, 1);`,
        "    const format = target.addConditionalFormat(ExcelScript.ConditionalFormatType.cellValue);",
        '    format.getCellValue().getFormat().getFill().setColor("#FFF2CC");',
        `    format.getCellValue().setRule({ formula1: ${js(String(recipe.value))}, operator: ${js(recipe.operator)} });`,
        "  }",
      );
    } else if (recipe.kind === "pivot") {
      lines.push(
        "  {",
        '    if (workbook.getWorksheet("Vynor Pivot")) throw new Error("A sheet named Vynor Pivot already exists.");',
        '    const pivotSheet = workbook.addWorksheet("Vynor Pivot");',
        '    const pivot = pivotSheet.addPivotTable("VynorPivot", range, pivotSheet.getRange("A3"));',
        `    pivot.addRowHierarchy(pivot.getHierarchy(${js(recipe.rows)}));`,
        `    pivot.addDataHierarchy(pivot.getHierarchy(${js(recipe.values)}));`,
        "  }",
      );
    } else {
      lines.push(
        "  const headerFormat = range.getRow(0).getFormat();",
        "  headerFormat.getFont().setBold(true);",
        '  headerFormat.getFill().setColor("#D9E1F2");',
      );
    }
  }
  lines.push("}");
  return lines.join("\n");
}

function vbaCode(recipes: Recipe[]): string {
  const lines: string[] = [
    "Sub VynorMacro()",
    "    Dim ws As Worksheet: Set ws = ActiveSheet",
    "    Dim ur As Range: Set ur = ws.UsedRange",
    "    Dim firstRow As Long: firstRow = ur.Row",
    "    Dim firstCol As Long: firstCol = ur.Column",
    "    Dim lastRow As Long: lastRow = firstRow + ur.Rows.Count - 1",
    "    Dim lastCol As Long: lastCol = firstCol + ur.Columns.Count - 1",
    "    Dim idx As Variant",
  ];
  const find = (name: string) => [
    `    idx = Application.Match(${vba(name)}, ws.Range(ws.Cells(firstRow, firstCol), ws.Cells(firstRow, lastCol)), 0)`,
    `    If IsError(idx) Then MsgBox "Column " & ${vba(name)} & " was not found in the header row.": Exit Sub`,
  ];
  for (const recipe of recipes) {
    if (recipe.kind === "total") {
      lines.push(
        `    If Not IsError(Application.Match(${vba(recipe.name)}, ws.Range(ws.Cells(firstRow, firstCol), ws.Cells(firstRow, lastCol)), 0)) Then MsgBox "A ${recipe.name} column already exists.": Exit Sub`,
        "    Dim sumRefs As String",
        '    sumRefs = ""',
      );
      for (const source of recipe.sources) {
        lines.push(
          ...find(source),
          '    sumRefs = sumRefs & IIf(sumRefs = "", "", ",") & ws.Cells(firstRow + 1, firstCol + idx - 1).Address(False, False)',
        );
      }
      lines.push(
        `    ws.Cells(firstRow, lastCol + 1).Value = ${vba(recipe.name)}`,
        '    If lastRow > firstRow Then ws.Range(ws.Cells(firstRow + 1, lastCol + 1), ws.Cells(lastRow, lastCol + 1)).Formula = "=SUM(" & sumRefs & ")"',
        "    lastCol = lastCol + 1",
        "    Set ur = ws.Range(ws.Cells(firstRow, firstCol), ws.Cells(lastRow, lastCol))",
      );
    } else if (recipe.kind === "sort") {
      lines.push(
        ...find(recipe.header),
        "    ur.Sort Key1:=ws.Cells(firstRow, firstCol + idx - 1), Order1:=" +
          (recipe.descending ? "xlDescending" : "xlAscending") +
          ", Header:=xlYes",
      );
    } else if (recipe.kind === "freeze") {
      lines.push(
        "    ws.Activate",
        "    ActiveWindow.FreezePanes = False",
        "    ws.Cells(firstRow + 1, 1).Select",
        "    ActiveWindow.FreezePanes = True",
      );
    } else if (recipe.kind === "autofit") {
      lines.push("    ur.Columns.AutoFit");
    } else if (recipe.kind === "dedupe") {
      lines.push(
        "    Dim all() As Variant: ReDim all(0 To ur.Columns.Count - 1)",
        "    Dim i As Long: For i = 0 To ur.Columns.Count - 1: all(i) = i + 1: Next i",
        "    ur.RemoveDuplicates Columns:=all, Header:=xlYes",
      );
    } else if (recipe.kind === "filter") {
      lines.push(
        "    If ws.AutoFilterMode Then ws.AutoFilterMode = False",
        "    ur.AutoFilter",
      );
    } else if (recipe.kind === "blank-rows") {
      lines.push(
        "    Dim r As Long",
        "    For r = lastRow To firstRow + 1 Step -1",
        "        If Application.WorksheetFunction.CountA(ws.Range(ws.Cells(r, firstCol), ws.Cells(r, lastCol))) = 0 Then ws.Range(ws.Cells(r, firstCol), ws.Cells(r, lastCol)).Delete Shift:=xlUp",
        "    Next r",
        "    lastRow = firstRow + ws.UsedRange.Rows.Count - 1",
        "    Set ur = ws.Range(ws.Cells(firstRow, firstCol), ws.Cells(lastRow, lastCol))",
      );
    } else if (recipe.kind === "highlight") {
      lines.push(
        ...find(recipe.header),
        "    With ws.Range(ws.Cells(firstRow + 1, firstCol + idx - 1), ws.Cells(lastRow, firstCol + idx - 1)).FormatConditions.Add(Type:=xlCellValue, Operator:=" +
          (recipe.operator === "GreaterThan"
            ? "xlGreater"
            : recipe.operator === "LessThan"
              ? "xlLess"
              : "xlEqual") +
          `, Formula1:="=${recipe.value}")`,
        "        .Interior.Color = RGB(255, 242, 204)",
        "    End With",
      );
    } else if (recipe.kind === "pivot") {
      lines.push(
        "    Dim pivotSheet As Worksheet",
        "    For Each pivotSheet In ThisWorkbook.Worksheets",
        '        If pivotSheet.Name = "Vynor Pivot" Then MsgBox "A sheet named Vynor Pivot already exists.": Exit Sub',
        "    Next pivotSheet",
        "    Dim cache As PivotCache: Set cache = ThisWorkbook.PivotCaches.Create(SourceType:=xlDatabase, SourceData:=ur)",
        "    Set pivotSheet = ThisWorkbook.Worksheets.Add",
        '    pivotSheet.Name = "Vynor Pivot"',
        '    Dim pivot As PivotTable: Set pivot = cache.CreatePivotTable(TableDestination:=pivotSheet.Range("A3"), TableName:="VynorPivot")',
        `    pivot.PivotFields(${vba(recipe.rows)}).Orientation = xlRowField`,
        `    pivot.AddDataField pivot.PivotFields(${vba(recipe.values)}), ${vba("Sum of " + recipe.values)}, xlSum`,
      );
    } else {
      lines.push(
        "    With ws.Range(ws.Cells(firstRow, firstCol), ws.Cells(firstRow, lastCol))",
        "        .Font.Bold = True",
        "        .Interior.Color = RGB(217, 225, 242)",
        "    End With",
      );
    }
  }
  lines.push("End Sub");
  return lines.join("\n");
}

const describe = (recipe: Recipe): string => {
  switch (recipe.kind) {
    case "sort":
      return `Sorts by "${recipe.header}" ${recipe.descending ? "descending" : "ascending"}, keeping the header row.`;
    case "total":
      return `Adds a "${recipe.name}" column: a live =SUM of ${recipe.sources.join(", ")} on every row.`;
    case "freeze":
      return "Freezes the header row.";
    case "autofit":
      return "Fits every column width to its content.";
    case "dedupe":
      return "Removes rows that repeat in every column (the first copy stays).";
    case "filter":
      return "Turns on the filter buttons in the header row.";
    case "blank-rows":
      return "Deletes rows that are completely empty inside the table (the cells below move up).";
    case "highlight":
      return `Highlights "${recipe.header}" cells ${recipe.operator === "GreaterThan" ? "greater than" : recipe.operator === "LessThan" ? "less than" : "equal to"} ${recipe.value} with a light yellow fill (a conditional format, so it follows the data).`;
    case "pivot":
      return `Creates a PivotTable on a new "Vynor Pivot" sheet: "${recipe.rows}" down the side, the sum of "${recipe.values}".`;
    default:
      return "Makes the header row bold with a light blue fill.";
  }
};

/**
 * Builds the code for a request. `headers` and `rows` come from the selection so every column name in
 * the code is one that exists; the code itself looks the columns up again at run time.
 */
export function generateMacro(
  instruction: string,
  headers: string[],
  rows: unknown[][],
): MacroResult {
  const language = detectMacroRequest(instruction);
  if (!language)
    return { ok: false, problem: "That is not a request to write code." };
  const names = headers.map((header) => String(header ?? ""));
  if (!names.every(safeName))
    return {
      ok: false,
      problem:
        "A column name contains a line break, so safe code cannot be written for it.",
    };
  const read = readRecipes(instruction, names, rows);
  if (read.problem) return { ok: false, problem: read.problem };

  const notes = [
    language === "vba"
      ? "Paste it into the VBA editor (Alt+F11, Insert, Module). VBA does not run in Excel on the web; save the file as .xlsm in desktop Excel."
      : "Paste it into Automate, New Script (Excel on the web or desktop with Microsoft 365). Run it on a copy first.",
    "VynorAI did not run this code and nothing in the workbook was changed.",
  ];
  if (read.recipes.some((recipe) => recipe.kind === "sort" && recipe.defaulted))
    notes.push(
      'You did not name a column, so it sorts by the first column. Say "sorts by <column>" to change that.',
    );
  if (read.recipes.some((recipe) => recipe.kind === "dedupe"))
    notes.push("Removing duplicates deletes rows; run it on a copy.");
  if (read.recipes.some((recipe) => recipe.kind === "blank-rows"))
    notes.push(
      "Deleting blank rows cannot be undone by Excel's own Undo after a macro; run it on a copy.",
    );

  return {
    ok: true,
    language,
    title: language === "vba" ? "VBA macro" : "Office Script",
    code:
      language === "vba" ? vbaCode(read.recipes) : officeScript(read.recipes),
    steps: read.recipes.map(describe),
    notes,
  };
}
