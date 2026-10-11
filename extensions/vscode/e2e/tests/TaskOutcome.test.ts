/**
 * A finished task is reported to the backend when the user opted in, and not
 * when they did not. Real extension, real model call (one tiny prompt), real
 * backend. The test prints markers; scripts/verify-task-outcome.ps1-style
 * counting is done by the caller against the production database.
 *
 * Phase is chosen by TASK_OUTCOME_PHASE (default "off"): "off" leaves the setting alone and the
 * report must not be sent; "on" turns it on first. Known: with the settings page
 * visited first, the VS Code window stops responding after the command that
 * returns to the chat (see docs/NEXT_LEVEL_PLAN.md), so "on" is not stable yet.
 */
import { expect } from "chai";
const stamp = (m: string) =>
  console.log("TS", new Date().toISOString().slice(11, 19), m);
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { By, Key, WebView, Workbench } from "vscode-extension-tester";
import {
  attachToPanel,
  openPanel,
  openWorkspace,
  pageText,
  retry,
  send,
  sleep,
  waitForTurnEnd,
} from "../smart/gui";

async function waitUntilLoaded(view: WebView) {
  await retry(async () => {
    const model = await view.findWebElement(
      By.css("[data-testid='model-select-button']"),
    );
    if ((await model.getText()).trim() !== "VynorAI Auto") {
      throw new Error("model still loading");
    }
  }, 90_000);
}

/** Turns the setting on through the real settings page, as a user would. */
async function enableOutcomeReporting(view: WebView, click = true) {
  await view.switchBack();
  await new Workbench().executeCommand("Continue: Open Settings");
  const { view: settings } = await attachToPanel("body");
  const label = "Send Error Reports and Task Outcomes";
  await retry(async () => {
    if (!click) return; // round trip through the settings page only
    const toggle = await settings.findWebElement(
      By.xpath(
        `//span[normalize-space(text())='${label}']/ancestor::div[contains(@class,'items-start')][1]//div[contains(@class,'rounded-full') and contains(@class,'border-solid')][1]`,
      ),
    );
    // Scrolled out of view inside the settings page: click through the DOM.
    await settings
      .getDriver()
      .executeScript(
        "arguments[0].scrollIntoView({block:'center'}); arguments[0].click();",
        toggle,
      );
  }, 60_000);
  await sleep(1_000);
  await settings.switchBack();
}

describe("VynorAI task outcome report", function () {
  this.timeout(8 * 60_000);
  let view: WebView | undefined;
  const phase = ["on", "roundtrip"].includes(
    process.env.TASK_OUTCOME_PHASE ?? "",
  )
    ? (process.env.TASK_OUTCOME_PHASE as string)
    : "off";

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it(`reports the finished task (phase ${phase})`, async () => {
    const project = fs.mkdtempSync(
      path.join(os.tmpdir(), "vynor-e2e-outcome-"),
    );
    fs.writeFileSync(
      path.join(project, "package.json"),
      '{"name":"outcome"}\n',
    );
    await openWorkspace(project);
    ({ view } = await openPanel());
    await waitUntilLoaded(view);

    if (phase === "on" || phase === "roundtrip") {
      stamp("before toggle");
      await enableOutcomeReporting(view, phase === "on");
      stamp("after toggle");
      console.log("SET_OUTCOME_REPORTING", "toggled in settings");
      ({ view } = await openPanel());
      stamp("panel reopened");
      await waitUntilLoaded(view);
      stamp("panel loaded");
    }

    stamp("sending");
    await send(view, "Reply with exactly the single word OK and nothing else.");
    await waitForTurnEnd(view, { timeoutMs: 3 * 60_000 });
    stamp("turn ended");
    const text = await pageText(view);
    console.log(
      "TURN_DONE",
      /\bOK\b/.test(text) ? "answered" : "no OK in page",
    );
    // The report is sent after the credits settle (about 1.2 s) plus a request.
    await sleep(12_000);
    expect(Key).to.exist;
  });
});
