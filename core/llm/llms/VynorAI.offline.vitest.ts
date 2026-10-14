import { describe, expect, it } from "vitest";
import VynorAI from "./VynorAI";

describe("VynorAI offline behavior", () => {
  it("fails truthfully after bounded retries when the endpoint is unreachable", async () => {
    const llm = new VynorAI({
      model: "vynor-auto",
      apiKey: "vynor_live_test",
      apiBase: "http://127.0.0.1:1/v1/",
    } as any);
    const started = Date.now();
    const collect = async () => {
      for await (const _chunk of llm.streamChat(
        [{ role: "user", content: "offline probe" }],
        new AbortController().signal,
      )) {
        // The unreachable endpoint must never yield fabricated content.
      }
    };
    await expect(collect()).rejects.toBeTruthy();
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
