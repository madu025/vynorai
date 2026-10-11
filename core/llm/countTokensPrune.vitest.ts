import { describe, expect, it } from "vitest";
import {
  countTokens,
  pruneLinesFromBottom,
  pruneLinesFromTop,
} from "./countTokens";

// The implementation this replaced: count every line, then drop from one end.
function referenceTop(prompt: string, maxTokens: number, model: string) {
  const lines = prompt.split("\n");
  const lineTokens = lines.map((l) => countTokens(l, model));
  let total =
    lineTokens.reduce((a, b) => a + b, 0) + Math.max(0, lines.length - 1);
  let start = 0;
  while (total > maxTokens && start < lines.length) {
    total -= lineTokens[start];
    if (lines.length - start > 1) total--;
    start++;
  }
  return lines.slice(start).join("\n");
}
function referenceBottom(prompt: string, maxTokens: number, model: string) {
  const lines = prompt.split("\n");
  const lineTokens = lines.map((l) => countTokens(l, model));
  let total =
    lineTokens.reduce((a, b) => a + b, 0) + Math.max(0, lines.length - 1);
  let end = lines.length;
  while (total > maxTokens && end > 0) {
    end--;
    total -= lineTokens[end];
    if (end > 0) total--;
  }
  return lines.slice(0, end).join("\n");
}

const WORDS = [
  "const",
  "function",
  "return",
  "x",
  "value",
  "=>",
  "{",
  "}",
  "  ",
  "import",
  "from",
  "await",
];
function sample(seed: number, lineCount: number) {
  let s = seed;
  const rnd = () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
  return Array.from({ length: lineCount }, () =>
    Array.from(
      { length: Math.floor(rnd() * 12) },
      () => WORDS[Math.floor(rnd() * WORDS.length)],
    ).join(" "),
  ).join("\n");
}

describe("pruneLines keeps what the full count kept", () => {
  for (const model of ["gpt-4", "llama2"]) {
    it(`matches the reference on varied inputs (${model})`, () => {
      for (let seed = 1; seed <= 25; seed++) {
        const prompt = sample(seed, 1 + (seed % 40));
        for (const max of [-1, 0, 1, 5, 17, 60, 400, 100000]) {
          expect(pruneLinesFromTop(prompt, max, model)).toBe(
            referenceTop(prompt, max, model),
          );
          expect(pruneLinesFromBottom(prompt, max, model)).toBe(
            referenceBottom(prompt, max, model),
          );
        }
      }
    });
  }

  it("does not tokenize a file it will mostly drop", () => {
    const huge = Array.from(
      { length: 60000 },
      (_, i) => `const item${i} = { id: ${i}, name: "entry-${i}" };`,
    ).join("\n");
    const started = Date.now();
    const top = pruneLinesFromTop(huge, 500, "llama2");
    const bottom = pruneLinesFromBottom(huge, 500, "llama2");
    const ms = Date.now() - started;
    expect(top.split("\n").at(-1)).toContain("item59999");
    expect(bottom.split("\n")[0]).toContain("item0 ");
    expect(countTokens(top, "llama2")).toBeLessThanOrEqual(520);
    expect(ms).toBeLessThan(1500);
  });

  it("drops a single line too long to fit without tokenizing it", () => {
    const line = "a".repeat(5_000_000);
    const started = Date.now();
    expect(pruneLinesFromTop(`first\n${line}`, 100, "llama2")).toBe("");
    expect(pruneLinesFromBottom(`${line}\nlast`, 100, "llama2")).toBe("");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
