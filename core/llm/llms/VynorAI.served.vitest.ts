import * as http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import VynorAI from "./VynorAI";

// A real HTTP server speaking the OpenAI streaming format with the proxy's
// headers: no mocks.
let server: http.Server;
let base = "";
let sendHeaders = true;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/event-stream");
    if (sendHeaders) {
      res.setHeader("X-VynorAI-Model", "deepseek/deepseek-v4-pro");
      res.setHeader("X-VynorAI-Tier", "heavy");
    }
    const chunk = (delta: object) =>
      `data: ${JSON.stringify({
        id: "c1",
        object: "chat.completion.chunk",
        choices: [{ index: 0, delta }],
      })}\n\n`;
    res.write(chunk({ role: "assistant", content: "Hello" }));
    res.write(chunk({ content: " world" }));
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
});

afterAll(() => server.close());

async function collect() {
  const llm = new VynorAI({
    model: "vynor-auto",
    apiKey: "vynor_live_test",
    apiBase: base,
  } as any);
  const chunks: any[] = [];
  for await (const chunk of llm.streamChat(
    [{ role: "user", content: "hi" }],
    new AbortController().signal,
  )) {
    chunks.push(chunk);
  }
  // token statistics are written in the background; let that settle
  await new Promise((resolve) => setTimeout(resolve, 400));
  return chunks;
}

describe("VynorAI served-model metadata", () => {
  it("passes the router's model and tier on, ahead of the text", async () => {
    sendHeaders = true;
    const chunks = await collect();
    const text = chunks.map((c) => c.content).join("");
    expect(text).toBe("Hello world");
    const meta = chunks.find((c) => c.metadata?.vynorServed);
    expect(meta.metadata.vynorServed).toEqual({
      model: "deepseek/deepseek-v4-pro",
      tier: "heavy",
    });
    expect(chunks.indexOf(meta)).toBe(0);
  });

  it("adds nothing when the server does not report a model", async () => {
    sendHeaders = false;
    const chunks = await collect();
    expect(chunks.some((c) => c.metadata?.vynorServed)).toBe(false);
    expect(chunks.map((c) => c.content).join("")).toBe("Hello world");
  });
});
