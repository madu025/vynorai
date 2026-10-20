/**
 * "How much of each item did each circuit (or customer, site, job) use?" Aggregation for the usage
 * dashboard. Quantities of different units are never added together: each unit gets its own total, and
 * the length-like units are converted to one (metres to kilometres) so "km" and "m" rows agree.
 * Pure and streaming: rows are added in chunks, so a table of hundreds of thousands of rows is never
 * held as a whole.
 */

export interface UnitGroup {
  /** Shown name, for example "Ea" or "km". */
  label: string;
  /** The raw spellings found in the data that belong to this group. */
  raw: Array<{ text: string; factor: number }>;
}

const CONVERSIONS: Array<{ pattern: RegExp; to: string; factor: number }> = [
  {
    pattern: /^(m|mtr|mtrs|meter|meters|metre|metres)$/i,
    to: "km",
    factor: 0.001,
  },
  {
    pattern: /^(cm|centimeter|centimeters|centimetre|centimetres)$/i,
    to: "km",
    factor: 0.00001,
  },
  {
    pattern: /^(mm|millimeter|millimeters|millimetre|millimetres)$/i,
    to: "km",
    factor: 0.000001,
  },
  {
    pattern: /^(km|kilometer|kilometers|kilometre|kilometres)$/i,
    to: "km",
    factor: 1,
  },
  { pattern: /^(g|gram|grams)$/i, to: "kg", factor: 0.001 },
  { pattern: /^(kg|kilogram|kilograms|kilo|kilos)$/i, to: "kg", factor: 1 },
  {
    pattern: /^(ml|milliliter|milliliters|millilitre|millilitres)$/i,
    to: "l",
    factor: 0.001,
  },
  { pattern: /^(l|lt|ltr|liter|liters|litre|litres)$/i, to: "l", factor: 1 },
];

/** The group a raw unit text belongs to, and what to multiply its quantity by. */
export function normalizeUnit(raw: unknown): { label: string; factor: number } {
  const text = String(raw ?? "").trim();
  if (!text) return { label: "(no unit)", factor: 1 };
  for (const rule of CONVERSIONS)
    if (rule.pattern.test(text)) return { label: rule.to, factor: rule.factor };
  return { label: text, factor: 1 };
}

const round = (value: number) => Math.round(value * 1000) / 1000;

export interface RankedEntity {
  entity: string;
  quantity: number;
  items: number;
}

export interface UsageResult {
  entities: number;
  items: number;
  /** Rows that counted: an entity, an item and a number. */
  lines: number;
  skipped: number;
  /** Largest total first. */
  units: Array<{ label: string; total: number; raw: UnitGroup["raw"] }>;
  topByUnit: Record<string, RankedEntity[]>;
  topByItems: Array<{ entity: string; items: number }>;
}

interface EntityRecord {
  /** First spelling seen, shown in the tables. */
  name: string;
  items: Set<string>;
  byUnit: Map<string, number>;
}

export class UsageAccumulator {
  private readonly entities = new Map<string, EntityRecord>();
  private readonly items = new Set<string>();
  private readonly unitTotals = new Map<string, number>();
  private readonly unitRaw = new Map<string, Map<string, number>>();
  /** Spellings that differ only in case or surrounding spaces are one entity, item or unit (as in Excel). */
  private readonly unitLabels = new Map<string, string>();
  private lines = 0;
  private skipped = 0;

  /** One row. A row without an entity, an item or a numeric quantity is counted as skipped. */
  add(entity: unknown, item: unknown, quantity: unknown, unit?: unknown): void {
    const entityText = String(entity ?? "").trim();
    const itemText = String(item ?? "").trim();
    const amount =
      typeof quantity === "number"
        ? quantity
        : Number(
            String(quantity ?? "")
              .replace(/,/g, "")
              .trim(),
          );
    if (
      !entityText ||
      !itemText ||
      !Number.isFinite(amount) ||
      quantity === "" ||
      quantity === null
    ) {
      this.skipped += 1;
      return;
    }
    const normalized = normalizeUnit(unit);
    const factor = normalized.factor;
    const unitKey = normalized.label.toLowerCase();
    const label = this.unitLabels.get(unitKey) ?? normalized.label;
    this.unitLabels.set(unitKey, label);
    const converted = amount * factor;
    const entityKey = entityText.toLowerCase();
    let record = this.entities.get(entityKey);
    if (!record) {
      record = { name: entityText, items: new Set(), byUnit: new Map() };
      this.entities.set(entityKey, record);
    }
    const itemKey = itemText.toLowerCase();
    record.items.add(itemKey);
    record.byUnit.set(label, (record.byUnit.get(label) ?? 0) + converted);
    this.items.add(itemKey);
    this.unitTotals.set(label, (this.unitTotals.get(label) ?? 0) + converted);
    const raws = this.unitRaw.get(label) ?? new Map<string, number>();
    const rawText = String(unit ?? "").trim();
    // One entry per spelling ignoring case, because the sheet formulas compare without case.
    if (
      ![...raws.keys()].some(
        (known) => known.toLowerCase() === rawText.toLowerCase(),
      )
    )
      raws.set(rawText, factor);
    this.unitRaw.set(label, raws);
    this.lines += 1;
  }

  finish(topN = 10): UsageResult {
    const units = [...this.unitTotals.entries()]
      .map(([label, total]) => ({
        label,
        total: round(total),
        raw: [...(this.unitRaw.get(label) ?? new Map()).entries()].map(
          ([text, factor]) => ({ text, factor }),
        ),
      }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
    const topByUnit: Record<string, RankedEntity[]> = {};
    for (const { label } of units) {
      topByUnit[label] = [...this.entities.entries()]
        .filter(([, record]) => record.byUnit.has(label))
        .map(([, record]) => ({
          entity: record.name,
          quantity: round(record.byUnit.get(label) ?? 0),
          items: record.items.size,
        }))
        .sort(
          (a, b) => b.quantity - a.quantity || a.entity.localeCompare(b.entity),
        )
        .slice(0, topN);
    }
    const topByItems = [...this.entities.entries()]
      .map(([, record]) => ({ entity: record.name, items: record.items.size }))
      .sort((a, b) => b.items - a.items || a.entity.localeCompare(b.entity))
      .slice(0, topN);
    return {
      entities: this.entities.size,
      items: this.items.size,
      lines: this.lines,
      skipped: this.skipped,
      units,
      topByUnit,
      topByItems,
    };
  }
}

/** Most units shown as separate totals and charts; the rest are named in the note. */
export const MAX_UNIT_BLOCKS = 3;
