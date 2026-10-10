import { describe, expect, it } from "vitest";
import { swarmAuthMeUrl } from "./swarm";

describe("swarmAuthMeUrl", () => {
  it("uses /api/auth/me on the origin, whatever path the model base has", () => {
    expect(swarmAuthMeUrl("https://api.vynor.lk")).toBe(
      "https://api.vynor.lk/api/auth/me",
    );
    expect(swarmAuthMeUrl("https://api.vynor.lk/v1/")).toBe(
      "https://api.vynor.lk/api/auth/me",
    );
  });

  it("falls back to the site when the base is not a URL", () => {
    expect(swarmAuthMeUrl("not a url")).toBe("https://vynor.lk/api/auth/me");
  });
});
