/**
 * Small, browser-only state helpers for the task pane's AI interpretation mode.
 * No workbook values are stored: only the user's setting and short plain-language steps.
 */

export interface TaskpaneStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type InterpretationMemory = Record<
  string,
  { steps: string[]; at: number }
>;

export const AI_FIRST_KEY = "vynorai.m365.aiReadsEveryRequest";
export const MEMORY_KEY = "vynorai.m365.interpretMemory";

const MEMORY_LIMIT = 50;

function browserStorage(): TaskpaneStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function aiFirstOn(
  storage: TaskpaneStorage | undefined = browserStorage(),
): boolean {
  try {
    return storage?.getItem(AI_FIRST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAiFirst(
  on: boolean,
  storage: TaskpaneStorage | undefined = browserStorage(),
): void {
  try {
    if (on) storage?.setItem(AI_FIRST_KEY, "1");
    else storage?.removeItem(AI_FIRST_KEY);
  } catch {
    // Private windows or blocked storage leave the setting off.
  }
}

export function memoryKey(text: string, names: string[]): string {
  return `${text.toLowerCase().replace(/\s+/g, " ").trim()}|${names.join("\u0001")}`;
}

export function readMemory(
  storage: TaskpaneStorage | undefined = browserStorage(),
): InterpretationMemory {
  try {
    const value = storage?.getItem(MEMORY_KEY);
    return value ? (JSON.parse(value) as InterpretationMemory) : {};
  } catch {
    return {};
  }
}

export function rememberSteps(
  key: string,
  steps: string[],
  storage: TaskpaneStorage | undefined = browserStorage(),
  now: () => number = Date.now,
): void {
  if (!key) return;
  try {
    const memory = readMemory(storage);
    memory[key] = { steps: [...steps], at: now() };
    const kept = Object.entries(memory)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, MEMORY_LIMIT);
    storage?.setItem(MEMORY_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // Private windows or blocked storage: the AI is asked again next time.
  }
}

export function recallSteps(
  key: string,
  storage: TaskpaneStorage | undefined = browserStorage(),
): string[] | undefined {
  const found = readMemory(storage)[key];
  return Array.isArray(found?.steps) && found.steps.length
    ? found.steps.filter((step) => typeof step === "string")
    : undefined;
}
