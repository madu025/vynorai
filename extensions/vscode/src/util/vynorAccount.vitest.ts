import { describe, expect, it } from "vitest";
import {
  accountEmailFor,
  boundEmail,
  checkVynorKey,
  makeBinding,
  parseQuota,
} from "./vynorAccount";

const KEY_A = "vynor_live_" + "a".repeat(32);
const KEY_B = "vynor_live_" + "b".repeat(32);
const me = {
  user: { email: "dev@example.lk" },
  monthlyUsage: { plan_name: "pro", max_tokens: 1000, used_tokens: 250 },
};
const reply = (status: number, body: unknown = {}) =>
  (async () =>
    new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("checkVynorKey", () => {
  it("returns the account that owns the key", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string, init: any) => {
      seen.push(`${url} ${init.headers.Authorization}`);
      return new Response(JSON.stringify(me));
    }) as unknown as typeof fetch;
    const r = await checkVynorKey(KEY_A, "https://vynor.lk", fetchImpl);
    expect(r.ok && r.quota.email).toBe("dev@example.lk");
    expect(r.ok && r.quota.remainingTokens).toBe(750);
    expect(seen[0]).toBe(`https://vynor.lk/api/auth/me Bearer ${KEY_A}`);
  });

  it("rejects a key the server refuses", async () => {
    for (const status of [401, 403]) {
      const r = await checkVynorKey(KEY_A, "https://x", reply(status));
      expect(r).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("does not call a network or server failure an invalid key", async () => {
    const down = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect(await checkVynorKey(KEY_A, "https://x", down)).toEqual({
      ok: false,
      reason: "unreachable",
    });
    expect(await checkVynorKey(KEY_A, "https://x", reply(500))).toEqual({
      ok: false,
      reason: "unreachable",
    });
  });
});

describe("account binding", () => {
  it("is valid only for the key it was made with", () => {
    const binding = makeBinding(KEY_A, "dev@example.lk");
    expect(boundEmail(binding, KEY_A)).toBe("dev@example.lk");
    expect(boundEmail(binding, KEY_B)).toBe("");
  });

  it("ignores missing or malformed records", () => {
    expect(boundEmail(undefined, KEY_A)).toBe("");
    expect(boundEmail({ email: 5 }, KEY_A)).toBe("");
    expect(boundEmail("dev@example.lk", KEY_A)).toBe("");
  });

  it("takes the server's email over the one handed in", () => {
    const quota = parseQuota(me);
    expect(accountEmailFor(quota, "other@example.lk")).toBe("dev@example.lk");
    expect(accountEmailFor(undefined, "other@example.lk")).toBe(
      "other@example.lk",
    );
    expect(accountEmailFor(undefined, "Developer")).toBe("");
  });
});
