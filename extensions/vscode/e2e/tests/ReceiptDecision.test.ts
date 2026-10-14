import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "chai";
import { By, WebView } from "vscode-extension-tester";
import {
  attachToPanel,
  isStreaming,
  newSession,
  openPanel,
  openWorkspace,
  retry,
  selectMode,
  send,
  signIn,
} from "../smart/gui";

type TaskProjection = {
  state: string;
  contract?: { criteria?: Array<{ status: string }> };
};

function taskDirectory(): string {
  const root = process.env.CONTINUE_GLOBAL_DIR;
  if (!root) throw new Error("CONTINUE_GLOBAL_DIR is required");
  return path.join(path.resolve(root), "agent-tasks");
}

function latestTask(): TaskProjection {
  const files = fs
    .readdirSync(taskDirectory())
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      mtime: fs.statSync(path.join(taskDirectory(), file)).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime);
  if (!files[0]) throw new Error("No task journal was written");
  return JSON.parse(
    fs.readFileSync(path.join(taskDirectory(), files[0].file), "utf8"),
  ) as TaskProjection;
}

describe("completion receipt decisions", function () {
  this.timeout(8 * 60_000);
  let view: WebView | undefined;

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("records explicit user-skipped criteria without turning them green", async () => {
    const taskFile = process.env.RECEIPT_DECISION_TASK_FILE;
    if (!taskFile) throw new Error("RECEIPT_DECISION_TASK_FILE is required");
    const task = JSON.parse(fs.readFileSync(taskFile, "utf8")) as {
      dir: string;
      prompt: string;
    };

    await openWorkspace(task.dir);
    await signIn();
    ({ view } = await openPanel());
    await newSession(view);
    await retry(async () => {
      const model = await view!.findWebElement(
        By.css("[data-testid='model-select-button']"),
      );
      if ((await model.getText()).trim() !== "VynorAI Auto") {
        throw new Error("model still loading");
      }
    }, 90_000);
    await selectMode(view, "Agent");
    await send(view, task.prompt);

    const approvedToolCalls = new Set<string>();
    const approvePendingToolCalls = async () => {
      const buttons = await view!.findWebElements(
        By.css("[data-testid*='accept-tool-call-button']"),
      );
      for (const button of buttons) {
        const id = await button.getAttribute("data-testid").catch(() => "");
        if (!id || approvedToolCalls.has(id)) continue;
        await button.click().catch(() => undefined);
        approvedToolCalls.add(id);
      }
    };

    await retry(async () => {
      await approvePendingToolCalls();
      const current = latestTask();
      if (current.state !== "verifying")
        throw new Error(`task is ${current.state}, not verifying`);
      if (!current.contract?.criteria?.length)
        throw new Error("verification criteria are not persisted yet");
    }, 240_000);
    console.log("RECEIPT_DECISION_VERIFYING");

    await retry(async () => {
      if (await isStreaming(view!)) throw new Error("stream is still active");
    }, 30_000);

    // The control center is expanded by default, but explicitly expand it if
    // the panel restored a collapsed state from the prior session.
    const expanders = await view.findWebElements(
      By.css(
        "section[aria-label='Agent Control Center'] button[aria-expanded]",
      ),
    );
    if (
      expanders.length &&
      (await expanders[0].getAttribute("aria-expanded")) === "false"
    )
      await expanders[0].click();

    await retry(async () => {
      const skips = await view!.findWebElements(
        By.css("button[aria-label^='Skip verification for']"),
      );
      if (!skips.length) throw new Error("no verification skip controls");
    }, 30_000);
    console.log("RECEIPT_DECISION_SKIP_CONTROLS_VISIBLE");
    // The product asks for an explicit confirmation before recording a skip.
    // In this real browser run, answer that confirmation explicitly instead
    // of relying on a native dialog's default dismissal behavior.
    await view.getDriver().executeScript("window.confirm = () => true;");

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const skips = await view.findWebElements(
        By.css("button[aria-label^='Skip verification for']"),
      );
      if (!skips.length) break;
      console.log(`RECEIPT_DECISION_CLICK_${attempt + 1}`);
      const pendingBefore = (latestTask().contract?.criteria ?? []).filter(
        (criterion) => criterion.status === "pending",
      ).length;
      await skips[0].click();
      await view
        .getDriver()
        .switchTo()
        .alert()
        .accept()
        .catch(() => undefined);
      await retry(async () => {
        const pendingAfter = (latestTask().contract?.criteria ?? []).filter(
          (criterion) => criterion.status === "pending",
        ).length;
        if (pendingAfter >= pendingBefore)
          throw new Error("verification skip decision not persisted yet");
      }, 10_000);
    }
    console.log("RECEIPT_DECISION_SKIP_CONTROLS_DONE");

    await retry(async () => {
      const current = latestTask();
      const criteria = current.contract?.criteria ?? [];
      if (
        !criteria.length ||
        criteria.some((criterion) => criterion.status !== "user_skipped")
      )
        throw new Error("not all criteria have explicit user-skipped receipts");
    }, 30_000);
    expect(
      latestTask().contract?.criteria?.every(
        (criterion) => criterion.status === "user_skipped",
      ),
    ).to.equal(true);
  });
});
