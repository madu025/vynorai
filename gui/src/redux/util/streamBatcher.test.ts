import { describe, expect, it } from "vitest";
import type { ChatMessage } from "core";
import { createStreamBatcher } from "./streamBatcher";

const piece = (text: string): ChatMessage[] => [
  { role: "assistant", content: text },
];

describe("createStreamBatcher", () => {
  it("applies many small pieces as few updates, in order, losing nothing", () => {
    let clock = 1000;
    const applied: string[][] = [];
    const batcher = createStreamBatcher(
      (m) => applied.push(m.map((x) => String(x.content))),
      () => clock,
      80,
    );
    for (let i = 0; i < 100; i++) {
      clock += 5; // 100 pieces over 500 ms
      batcher.push(piece(String(i)));
    }
    batcher.flush();
    expect(applied.length).toBeLessThan(10);
    expect(applied.flat()).toEqual(
      Array.from({ length: 100 }, (_, i) => String(i)),
    );
  });

  it("applies the first piece at once and the tail on flush", () => {
    let clock = 5000;
    const applied: string[][] = [];
    const batcher = createStreamBatcher(
      (m) => applied.push(m.map((x) => String(x.content))),
      () => clock,
      80,
    );
    batcher.push(piece("a"));
    expect(applied).toEqual([["a"]]);
    clock += 10;
    batcher.push(piece("b"));
    expect(applied).toEqual([["a"]]); // held back
    batcher.flush();
    expect(applied).toEqual([["a"], ["b"]]);
  });

  it("flush with nothing pending applies nothing", () => {
    const applied: unknown[] = [];
    const batcher = createStreamBatcher((m) => applied.push(m));
    batcher.flush();
    expect(applied).toEqual([]);
  });
});
