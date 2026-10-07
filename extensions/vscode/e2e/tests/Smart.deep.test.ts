import { WebView } from "vscode-extension-tester";
import {
  approvalCount,
  creditsUsed,
  lastReply,
  newSession,
  openPanel,
  openWorkspace,
  selectMode,
  send,
  signIn,
  waitForTurnEnd,
} from "../smart/gui";
import { judge } from "../smart/model";
import {
  loadModule,
  read,
  resetWorkspace,
  runProjectTests,
  snapshot,
} from "../smart/project";
import { CheckFailed, smartScenario } from "../smart/runner";

const TURN = Number(process.env.VYNOR_E2E_TURN_TIMEOUT_MS ?? 6 * 60_000);
const CREDIT_CEILING = 900_000;

describe("VynorAI deep cross-layer E2E (real model)", function () {
  this.timeout(TURN * 4);
  let view: WebView;

  before(async function () {
    this.timeout(3 * 60_000);
    await openWorkspace(resetWorkspace("concurrent-transfer"));
    await signIn();
  });

  async function turn(prompt: string) {
    await send(view, prompt);
    await waitForTurnEnd(view, { timeoutMs: TURN });
  }

  it("repairs a concurrent invariant and preserves it across a follow-up", async () => {
    await smartScenario(
      "concurrent-transfer-invariant",
      "The agent prevents same-source overspending without globally serializing unrelated accounts, adds a concurrent regression test, passes tests, and explains the invariant on a read-only follow-up.",
      async () => {
        resetWorkspace("concurrent-transfer");
        ({ view } = await openPanel());
        await newSession(view);
        await selectMode(view, "Agent");
        const beforeCredits = await creditsUsed();

        await turn(
          "AccountStore has a real overspending race: two simultaneous transfers of 80 from an account with 100 can both succeed. Diagnose and fix it, preserve the constructor/checkpoint API, add a regression test using Promise.all, and run the tests. Transfers from unrelated source accounts must still be able to make progress concurrently; do not solve this with one global lock.",
        );

        const evidence = `${snapshot()}\n--- reply\n${await lastReply(view)}`;
        if ((await approvalCount(view)) > 0)
          throw new CheckFailed(
            "safe edit/test unexpectedly requested approval",
            evidence,
          );
        const tests = runProjectTests();
        if (!tests.ok)
          throw new CheckFailed("project tests fail", tests.output);
        if (!/Promise\.all/.test(read("test/accountStore.test.js")))
          throw new CheckFailed(
            "no concurrent regression test was added",
            evidence,
          );

        const { AccountStore } = loadModule("src/accountStore.js");
        const sameSource = new AccountStore({ source: 100, left: 0, right: 0 });
        const outcomes = await Promise.all([
          sameSource.transfer("source", "left", 80),
          sameSource.transfer("source", "right", 80),
        ]);
        if (outcomes.filter(Boolean).length !== 1)
          throw new CheckFailed(
            `same-source outcomes were ${JSON.stringify(outcomes)}`,
            evidence,
          );
        const total =
          sameSource.balance("source") +
          sameSource.balance("left") +
          sameSource.balance("right");
        if (sameSource.balance("source") !== 20 || total !== 100)
          throw new CheckFailed(
            `money invariant failed: source=${sameSource.balance("source")} total=${total}`,
            evidence,
          );

        let arrivals = 0;
        let release!: () => void;
        const gate = new Promise<void>((resolve) => (release = resolve));
        const unrelated = new AccountStore(
          { a: 50, b: 0, c: 50, d: 0 },
          async () => {
            arrivals++;
            if (arrivals === 2) release();
            await gate;
          },
        );
        await Promise.race([
          Promise.all([
            unrelated.transfer("a", "b", 10),
            unrelated.transfer("c", "d", 10),
          ]),
          new Promise((_, reject) =>
            setTimeout(
              () =>
                reject(
                  new Error(
                    `unrelated transfers serialized; arrivals=${arrivals}`,
                  ),
                ),
              2_000,
            ),
          ),
        ]);
        if (arrivals !== 2)
          throw new CheckFailed(`unrelated arrivals=${arrivals}`, evidence);

        const implementationBeforeFollowUp = read("src/accountStore.js");
        const testsBeforeFollowUp = read("test/accountStore.test.js");
        await turn(
          "Review the solution you just implemented. In one short paragraph, explain why transfers from the same source cannot overspend and why unrelated source accounts can progress independently. Do not modify files or run commands.",
        );
        if (
          read("src/accountStore.js") !== implementationBeforeFollowUp ||
          read("test/accountStore.test.js") !== testsBeforeFollowUp
        )
          throw new CheckFailed(
            "read-only follow-up modified project files",
            snapshot(),
          );
        const answer = await lastReply(view);
        const verdict = await judge({
          task: "Explain the repaired AccountStore concurrency invariant.",
          answer,
          criteria: [
            "Explains that same-source transfers are serialized or guarded so stale balances cannot both commit.",
            "Explains that locking is scoped by account/source rather than one global lock, allowing unrelated sources to progress independently.",
          ],
        });
        if (!verdict.pass) throw new CheckFailed(verdict.reason, answer);

        const used = (await creditsUsed()) - beforeCredits;
        if (used > CREDIT_CEILING)
          throw new CheckFailed(
            `used ${used} credits (ceiling ${CREDIT_CEILING})`,
          );
        return { creditsUsed: used };
      },
      { retries: 0 },
    );
  });
});
