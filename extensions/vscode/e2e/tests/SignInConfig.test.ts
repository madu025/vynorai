import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { signIn } from "../smart/gui";

/**
 * Signing in rewrites config.json. Run this against a global folder whose
 * config.json already holds many VynorAI models (the old bug added one per
 * sign-in/activation): afterwards it must hold exactly Auto and one Coder, and
 * a second sign-in must not add anything. Needs VYNORAI_E2E_API_KEY.
 */
const globalDir = path.resolve(process.env.CONTINUE_GLOBAL_DIR || "");

function modelCount(): { n: number; titles: string[] } {
  const raw = JSON.parse(
    fs.readFileSync(path.join(globalDir, "config.json"), "utf8"),
  );
  return { n: raw.models.length, titles: raw.models.map((m: any) => m.title) };
}

describe("VynorAI sign-in keeps config.json models tidy", function () {
  this.timeout(5 * 60_000);

  it("collapses duplicate VynorAI models and stays stable on a repeat sign-in", async () => {
    const before = modelCount();
    console.log("MODELS BEFORE:", before.n);
    await signIn();
    const first = modelCount();
    console.log(
      "MODELS AFTER 1st SIGN-IN:",
      first.n,
      JSON.stringify(first.titles),
    );
    await signIn();
    const second = modelCount();
    console.log("MODELS AFTER 2nd SIGN-IN:", second.n);

    expect(first.titles[0]).to.equal("VynorAI Auto");
    expect(first.titles.filter((t) => t === "VynorAI Auto")).to.have.length(1);
    expect(first.titles.filter((t) => t === "VynorAI Coder")).to.have.length(1);
    expect(first.n).to.be.lessThan(before.n > 5 ? before.n : 6);
    expect(second.n).to.equal(first.n);
  });
});
