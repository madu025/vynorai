import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVynorModel, postToVynor } from "./vynorBackend";
import { WEBVIEW_TO_CORE_PASS_THROUGH } from "../protocol/passThrough";

let server: http.Server;
let base = "";
const seen: Array<{ url?: string; auth?: string; body: string }> = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({ url: req.url, auth: req.headers.authorization, body });
      res.statusCode = req.url?.includes("fail") ? 500 : 200;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());

describe("postToVynor", () => {
  it("posts the report with the user's key to the model's backend", async () => {
    const ok = await postToVynor(
      { apiBase: `${base}/`, apiKey: "vynor_live_x", providerName: "vynorai" },
      "task-outcomes",
      { outcome: "completed", rounds: 3 },
    );
    expect(ok).toBe(true);
    const call = seen.at(-1)!;
    expect(call.url).toBe("/v1/task-outcomes");
    expect(call.auth).toBe("Bearer vynor_live_x");
    expect(JSON.parse(call.body)).toEqual({ outcome: "completed", rounds: 3 });
  });

  it("sends nothing for a model that is not VynorAI or has no key", async () => {
    const before = seen.length;
    expect(
      await postToVynor(
        {
          apiBase: "https://api.openai.com/v1",
          apiKey: "k",
          providerName: "openai",
        },
        "task-outcomes",
        {},
      ),
    ).toBe(false);
    expect(
      await postToVynor(
        { apiBase: base, providerName: "vynorai" },
        "task-outcomes",
        {},
      ),
    ).toBe(false);
    expect(seen.length).toBe(before);
    expect(isVynorModel(undefined)).toBe(false);
  });

  it("never throws on a server error or an unreachable host", async () => {
    expect(
      await postToVynor(
        { apiBase: base, apiKey: "k", providerName: "vynorai" },
        "fail",
        {},
      ),
    ).toBe(false);
    expect(
      await postToVynor(
        {
          apiBase: "http://127.0.0.1:1/vynor",
          apiKey: "k",
          providerName: "vynorai",
        },
        "x",
        {},
      ),
    ).toBe(false);
  });

  it("the GUI message is on the core pass-through list", () => {
    expect(WEBVIEW_TO_CORE_PASS_THROUGH).toContain("vynor/taskOutcome");
  });
});
