import { Workbench } from "vscode-extension-tester";
import { CheckFailed, smartScenario } from "../smart/runner";
import {
  approvalCount,
  creditsUsed,
  lastReply,
  openPanel,
  openWorkspace,
  selectMode,
  send,
  signIn,
  waitForTurnEnd,
} from "../smart/gui";
import {
  resetWorkspace,
  callExport,
  read,
  runProjectTests,
  snapshot,
  WORKSPACE,
} from "../smart/project";

const TURN = 5 * 60_000;
const CREDIT_CEILING = 600_000;

describe("VynorAI smart E2E bug fix", function () {
  this.timeout(TURN * 3);
  let view: any;

  before(async function () {
    this.timeout(3 * 60_000);
    await openWorkspace(resetWorkspace());
    await signIn();
  });

  it("agent: finds and fixes a failing test", async () => {
    await smartScenario(
      "bug-fix",
      "The bug in subtract() is fixed, add() untouched, tests pass.",
      async () => {
        resetWorkspace();
        await new Workbench()
          .executeCommand("continue.newSession")
          .catch(() => undefined);
        ({ view } = await openPanel());
        await selectMode(view, "Agent");
        const fs = await import("fs");
        const path = await import("path");
        fs.writeFileSync(
          path.join(WORKSPACE, "math.js"),
          read("math.js").replace("return a - b;", "return b - a;"),
        );
        const beforeCredits = await creditsUsed();
        await send(view, "The tests are failing. Find the cause and fix it.");
        await waitForTurnEnd(view, { timeoutMs: TURN });
        const evidence = `${snapshot()}\n--- reply\n${await lastReply(view)}`;
        if ((await approvalCount(view)) > 0)
          throw new CheckFailed("unexpected approval", evidence);
        if (callExport("subtract", 5, 3) !== 2)
          throw new CheckFailed("subtract still wrong", evidence);
        if (callExport("add", 2, 3) !== 5)
          throw new CheckFailed("add() was broken", evidence);
        if (!runProjectTests().ok)
          throw new CheckFailed("tests still fail", evidence);
        return { creditsUsed: (await creditsUsed()) - beforeCredits };
      },
    );
  });
});
