/**
 * Smart E2E: the real extension, the real backend (vynor.lk) and the real
 * model, driven like a user. Checks look at outcomes (files on disk, tests
 * that run, UI state), an AI judge grades free-text answers, and failures
 * are retried once and classified (see e2e/smart/runner.ts).
 */
import { WebView } from "vscode-extension-tester";
import {
  approvalCount,
  clickStop,
  creditsUsed,
  isStreaming,
  lastReply,
  openPanel,
  openWorkspace,
  pageText,
  selectMode,
  send,
  signIn,
  sleep,
  waitForTurnEnd,
} from "../smart/gui";
import { judge } from "../smart/model";
import {
  callExport,
  read,
  resetWorkspace,
  runProjectTests,
  snapshot,
} from "../smart/project";
import { CheckFailed, smartScenario } from "../smart/runner";

const TURN = 5 * 60_000;
/** A single scenario should never cost more than this (credits). */
const CREDIT_CEILING = 600_000;

describe("VynorAI smart E2E (real model)", function () {
  this.timeout(TURN * 3);
  let view: WebView;

  before(async function () {
    this.timeout(3 * 60_000);
    await openWorkspace(resetWorkspace());
    await signIn();
  });

  /** Fresh project and chat for every attempt, so retries start clean. */
  async function freshAgent(mode = "Agent") {
    resetWorkspace();
    // Commands run in the workbench, outside the webview iframes.
    await view?.switchBack().catch(() => undefined);
    await new (await import("vscode-extension-tester")).Workbench()
      .executeCommand("continue.newSession")
      .catch(() => undefined);
    ({ view } = await openPanel());
    await selectMode(view, mode);
  }

  async function measured<T>(fn: () => Promise<T>) {
    const before = await creditsUsed();
    await fn();
    const used = (await creditsUsed()) - before;
    if (used > CREDIT_CEILING)
      throw new CheckFailed(`used ${used} credits (ceiling ${CREDIT_CEILING})`);
    return { creditsUsed: used };
  }

  it("chat: explains the project accurately", async () => {
    await smartScenario(
      "chat-explain",
      "A correct description of math.js (add and subtract, CommonJS export).",
      async () => {
        await freshAgent("Chat");
        return measured(async () => {
          await send(view, "What does math.js in this project do?");
          await waitForTurnEnd(view, { timeoutMs: TURN });
          const answer = await lastReply(view);
          const verdict = await judge({
            task: "What does math.js in this project do?",
            answer,
            criteria: [
              "Says math.js provides add and subtract functions.",
              "Does not invent functions that are not in the file (there is no multiply or divide).",
            ],
          });
          if (!verdict.pass) throw new CheckFailed(verdict.reason, answer);
        });
      },
    );
  });

  it("agent: adds a feature and verifies it without asking", async () => {
    await smartScenario(
      "agent-feature",
      "divide() added, a test added, the project's tests pass, no approval prompts (Auto mode).",
      async () => {
        await freshAgent();
        return measured(async () => {
          await send(
            view,
            "Add a divide(a, b) function to math.js that throws an Error when b is 0, add tests for it in math.test.js, and run the tests.",
          );
          await waitForTurnEnd(view, { timeoutMs: TURN });
          const evidence = `${snapshot()}\n--- reply\n${await lastReply(view)}`;
          if ((await approvalCount(view)) > 0)
            throw new CheckFailed(
              "Auto mode asked for approval on a safe edit/test",
              evidence,
            );
          if (callExport("divide", 6, 3) !== 2)
            throw new CheckFailed("divide(6, 3) !== 2", evidence);
          let threw = false;
          try {
            callExport("divide", 1, 0);
          } catch {
            threw = true;
          }
          if (!threw)
            throw new CheckFailed("divide(1, 0) did not throw", evidence);
          if (!/divide/.test(read("math.test.js")))
            throw new CheckFailed("no divide test was added", evidence);
          const tests = runProjectTests();
          if (!tests.ok)
            throw new CheckFailed("project tests fail", tests.output);
        });
      },
    );
  });

  it("agent: finds and fixes a failing test", async () => {
    await smartScenario(
      "bug-fix",
      "The bug in subtract() is fixed, add() untouched, tests pass.",
      async () => {
        await freshAgent();
        const fs = await import("fs");
        const path = await import("path");
        const { WORKSPACE } = await import("../smart/project");
        fs.writeFileSync(
          path.join(WORKSPACE, "math.js"),
          read("math.js").replace("return a - b;", "return b - a;"),
        );
        return measured(async () => {
          await send(view, "The tests are failing. Find the cause and fix it.");
          await waitForTurnEnd(view, { timeoutMs: TURN });
          const evidence = `${snapshot()}\n--- reply\n${await lastReply(view)}`;
          if (callExport("subtract", 5, 3) !== 2)
            throw new CheckFailed("subtract still wrong", evidence);
          if (callExport("add", 2, 3) !== 5)
            throw new CheckFailed("add() was broken", evidence);
          if (!runProjectTests().ok)
            throw new CheckFailed("tests still fail", evidence);
        });
      },
    );
  });

  it("agent: understands a Sinhala request", async () => {
    await smartScenario(
      "sinhala-request",
      "multiply() added from a Sinhala prompt and works.",
      async () => {
        await freshAgent();
        return measured(async () => {
          await send(
            view,
            "math.js එකට multiply(a, b) function එකක් එකතු කරලා export කරන්න.",
          );
          await waitForTurnEnd(view, { timeoutMs: TURN });
          if (callExport("multiply", 3, 4) !== 12)
            throw new CheckFailed("multiply(3, 4) !== 12", snapshot());
          if (!runProjectTests().ok)
            throw new CheckFailed("existing tests broke", snapshot());
        });
      },
    );
  });

  it("agent: asks before a risky action and changes nothing first", async () => {
    await smartScenario(
      "risky-needs-approval",
      "Installing a package shows an approval card; package.json is unchanged until approved.",
      async () => {
        await freshAgent();
        const before = read("package.json");
        await send(view, "Install the lodash package with npm.");
        await waitForTurnEnd(view, { timeoutMs: TURN });
        const evidence = `approvals=${await approvalCount(view)}\n${await pageText(view)}`;
        if ((await approvalCount(view)) === 0)
          throw new CheckFailed("no approval card for npm install", evidence);
        if (read("package.json") !== before)
          throw new CheckFailed(
            "package.json changed before approval",
            evidence,
          );
      },
    );
  });

  it("stop: ends the turn and leaves the panel usable", async () => {
    await smartScenario(
      "stop-button",
      "After Stop, streaming ends within 5s and stays ended.",
      async () => {
        await freshAgent();
        await send(
          view,
          "Write a detailed 2000-word explanation of how JavaScript closures work, with many examples.",
        );
        const started = Date.now();
        while (!(await isStreaming(view)) && Date.now() - started < 30_000)
          await sleep(300);
        if (!(await isStreaming(view)))
          throw new CheckFailed("the turn never started streaming");
        await clickStop(view);
        await sleep(5_000);
        if (await isStreaming(view))
          throw new CheckFailed("still streaming 5s after Stop");
        await sleep(5_000);
        if (await isStreaming(view))
          throw new CheckFailed("streaming restarted after Stop");
      },
    );
  });

  it("modes: Background is hidden while the feature is off", async () => {
    await smartScenario(
      "background-hidden",
      "With BG_ENABLED=false on the server, the mode menu has no Background option.",
      async () => {
        await freshAgent();
        const { By } = await import("vscode-extension-tester");
        const dropdown = await view.findWebElement(
          By.css("[data-testid='mode-select-button']"),
        );
        await dropdown.click();
        await sleep(800);
        const text = await pageText(view);
        await dropdown.click();
        if (/\bBackground\b/.test(text))
          throw new CheckFailed("Background option visible", text);
      },
      { retries: 0 },
    );
  });
});
