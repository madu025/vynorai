/**
 * A tiny stand-in for Excel's calculation in the agent harness: the fake 520,125-row sheet repeats
 * the 200 sample rows, and the common whole-column formulas the agent writes are computed exactly
 * over it (SUM, COUNTA, AVERAGE, MAX, MIN, SUMIFS, COUNTIFS, AVERAGEIFS, UNIQUE counts, GROUPBY).
 * Anything else gets a plausible stand-in of the right kind (a small table or one number). It only has to be consistent, so the
 * model's behaviour is judged on real-looking numbers; the live add-in checks real values.
 */
export const FAKE_ROWS = 520_125;

/** A formula this stand-in cannot compute: a plausible result of the right kind, as Excel would give. */
function unknown(body: string): unknown {
  return /GROUPBY|PIVOTBY|UNIQUE|FILTER|SORT|TAKE|HSTACK|VSTACK|MAP|BYROW|CHOOSECOLS/i.test(
    body,
  )
    ? [
        ["Item 1", 300],
        ["Item 2", 200],
        ["Item 3", 100],
      ]
    : [[100]];
}

export function fakeCalculator(rows: unknown[][]) {
  const at = (row: number, column: number) => rows[row % rows.length][column];
  const col = (ref: string) => {
    const match = /^'?detail-report'?!\$?([A-J])\$?2:\$?([A-J])\$?(\d+)$/i.exec(
      ref.trim(),
    );
    if (!match || match[1].toUpperCase() !== match[2].toUpperCase())
      return undefined;
    return {
      index: match[1].toUpperCase().charCodeAt(0) - 65,
      last: Math.min(Number(match[3]) - 1, FAKE_ROWS),
    };
  };
  const split = (args: string) => {
    const parts: string[] = [];
    let depth = 0;
    let quote = false;
    let current = "";
    for (const char of args) {
      if (char === '"') quote = !quote;
      if (!quote && char === "(") depth += 1;
      if (!quote && char === ")") depth -= 1;
      if (!quote && depth === 0 && char === ",") {
        parts.push(current.trim());
        current = "";
      } else current += char;
    }
    parts.push(current.trim());
    return parts;
  };
  const matches = (value: unknown, criterion: string) => {
    const text = criterion.replace(/^"|"$/g, "");
    const op = /^(<>|>=|<=|>|<|=)?(.*)$/.exec(text)!;
    const target = op[2];
    const number = Number(target);
    const v = typeof value === "number" ? value : String(value ?? "");
    switch (op[1]) {
      case ">":
        return Number(v) > number;
      case "<":
        return Number(v) < number;
      case ">=":
        return Number(v) >= number;
      case "<=":
        return Number(v) <= number;
      case "<>":
        return String(v).toLowerCase() !== target.toLowerCase();
      default:
        return String(v).toLowerCase() === target.toLowerCase();
    }
  };
  const fold = (
    index: number,
    last: number,
    take: (row: number) => boolean = () => true,
  ) => {
    let sum = 0;
    let count = 0;
    let max = -Infinity;
    let min = Infinity;
    for (let row = 0; row < last; row += 1) {
      if (!take(row)) continue;
      const value = at(row, index);
      count += 1;
      if (typeof value === "number") {
        sum += value;
        max = Math.max(max, value);
        min = Math.min(min, value);
      }
    }
    return { sum, count, max, min, average: count ? sum / count : 0 };
  };
  return (formula: string): unknown => {
    const body = formula.trim().replace(/^=/, "");
    const call = /^([A-Z.]+)\((.*)\)$/i.exec(body);
    if (!call) return unknown(body);
    const name = call[1].toUpperCase();
    const args = split(call[2]);
    const simple: Record<string, keyof ReturnType<typeof fold>> = {
      SUM: "sum",
      COUNTA: "count",
      COUNT: "count",
      ROWS: "count",
      AVERAGE: "average",
      MAX: "max",
      MIN: "min",
    };
    if (simple[name] && args.length === 1) {
      const unique = /^UNIQUE\((.*)\)$/i.exec(args[0]);
      if (unique && (name === "COUNTA" || name === "ROWS")) {
        const ref = col(unique[1]);
        if (!ref) return unknown(body);
        const seen = new Set<string>();
        for (let row = 0; row < ref.last; row += 1)
          seen.add(String(at(row, ref.index)));
        return [[seen.size]];
      }
      const ref = col(args[0]);
      if (ref) return [[fold(ref.index, ref.last)[simple[name]]]];
    }
    if (
      /^(SLOPE|INTERCEPT|RSQ|CORREL|PEARSON)$/.test(name) &&
      args.length === 2
    ) {
      // SLOPE(known_y, known_x); CORREL(x, y) is symmetric.
      const y = col(args[0]);
      const x = col(args[1]);
      if (!x || !y) return unknown(body);
      let n = 0;
      let sx = 0;
      let sy = 0;
      let sxx = 0;
      let syy = 0;
      let sxy = 0;
      for (let row = 0; row < FAKE_ROWS; row += 1) {
        const a = Number(at(row, x.index));
        const b = Number(at(row, y.index));
        n += 1;
        sx += a;
        sy += b;
        sxx += a * a;
        syy += b * b;
        sxy += a * b;
      }
      const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
      const r =
        (n * sxy - sx * sy) /
        Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
      const value =
        name === "SLOPE"
          ? slope
          : name === "INTERCEPT"
            ? (sy - slope * sx) / n
            : name === "RSQ"
              ? r * r
              : r;
      return [[value]];
    }
    if (/^(SUMIFS|AVERAGEIFS|COUNTIFS)$/.test(name)) {
      const measure = name === "COUNTIFS" ? undefined : col(args[0]);
      const pairs = name === "COUNTIFS" ? args : args.slice(1);
      const tests: { index: number; criterion: string }[] = [];
      for (let i = 0; i + 1 < pairs.length; i += 2) {
        const ref = col(pairs[i]);
        if (!ref) return unknown(body);
        tests.push({ index: ref.index, criterion: pairs[i + 1] });
      }
      const take = (row: number) =>
        tests.every((t) => matches(at(row, t.index), t.criterion));
      const result = fold(measure?.index ?? tests[0].index, FAKE_ROWS, take);
      return [
        [
          name === "SUMIFS"
            ? result.sum
            : name === "AVERAGEIFS"
              ? result.average
              : result.count,
        ],
      ];
    }
    // GROUPBY anywhere in the formula: the grouped table, the way most wrappers would show it.
    const start = body.toUpperCase().indexOf("GROUPBY(");
    let inner = "";
    if (start >= 0) {
      let depth = 0;
      for (let i = start + "GROUPBY".length; i < body.length; i += 1) {
        if (body[i] === "(") depth += 1;
        if (body[i] === ")") depth -= 1;
        inner += body[i];
        if (depth === 0) break;
      }
    }
    const groupArgs = inner ? split(inner.slice(1, -1)) : [];
    const groupby =
      groupArgs.length >= 3
        ? [, groupArgs[0], groupArgs[1], groupArgs[2]]
        : null;
    if (groupby) {
      // A month key such as EOMONTH(dates,-1)+1 or TEXT(dates,"yyyy-mm") groups by month.
      const monthly = /EOMONTH\(|TEXT\(/i.exec(groupby[1]!);
      const keyRef = monthly
        ? /('?detail-report'?![^,)]+)/i.exec(groupby[1]!)?.[1]
        : groupby[1];
      const key = keyRef ? col(keyRef) : undefined;
      const value = col(groupby[2]!);
      if (!key || !value) return unknown(body);
      const groups = new Map<string, number[]>();
      for (let row = 0; row < FAKE_ROWS; row += 1) {
        const raw = at(row, key.index);
        const k = monthly
          ? new Date((Number(raw) - 25569) * 86_400_000)
              .toISOString()
              .slice(0, 7)
          : String(raw);
        const list = groups.get(k) ?? [];
        list.push(Number(at(row, value.index)) || 0);
        groups.set(k, list);
      }
      const fn = groupby[3]!.toUpperCase();
      const table = [...groups]
        .map(([k, list]) => [
          k,
          fn === "COUNTA" || fn === "COUNT"
            ? list.length
            : fn === "AVERAGE"
              ? list.reduce((a, b) => a + b, 0) / list.length
              : fn === "MAX"
                ? Math.max(...list)
                : fn === "MIN"
                  ? Math.min(...list)
                  : list.reduce((a, b) => a + b, 0),
        ])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return /SORT/i.test(body)
        ? [...table].sort((a, b) => Number(b[1]) - Number(a[1]))
        : table;
    }
    return unknown(body);
  };
}
