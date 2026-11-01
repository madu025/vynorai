import { describe, expect, it } from "vitest";
import { randomFillSync, randomUUID } from "./browserCrypto";

describe("browserCrypto", () => {
  it("fills the buffer it is given and returns it", () => {
    const bytes = new Uint8Array(64);
    expect(randomFillSync(bytes)).toBe(bytes);
    expect(bytes.some((byte) => byte !== 0)).toBe(true);
  });

  it("gives a version 4 UUID", () => {
    expect(randomUUID()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
