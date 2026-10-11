/**
 * Arm D of the large task benchmark (docs/LARGE_TASK_BENCHMARK_PLAN.md): one
 * multi-file task through the real extension, real agent loop, real model.
 *
 * The fixture is prepared and scored outside this test:
 *   npx tsx backend/scripts/bench/large.ts --prepare <id> --dir <dir>
 *   LARGE_TASK_DIR=<dir> TEST_FILE=./e2e/_output/tests/LargeTask.test.js node scripts/run-e2e.js
 *   npx tsx backend/scripts/bench/large.ts --score <dir>
 * This test only drives the chat: send the prompt in Agent mode, approve tool
 * calls, press Continue when the round budget pauses the task, and record
 * what happened in <dir>/run.json. It never fails on the task result.
 */
import * as fs from "fs";
import * as path from "path";
import { By, WebView } from "vscode-extension-tester";
import {
  creditsUsed,
  isStreaming,
  lastReply,
  openPanel,
  openWorkspace,
  retry,
  selectMode,
  send,
  signIn,
  sleep,
  turnStateSnapshot,
} from "../smart/gui";

const LIMIT_MS = Number(process.env.LARGE_TASK_LIMIT_MIN ?? 25) * 60_000;
const QUIET_MS = 8_000;

/** A frozen window answers nothing; never wait on it forever. */
function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${what} did not answer in ${ms / 1000}s`)),
        ms,
      );
    }),
  ]).finally(() => timer && clearTimeout(timer));
}

async function clickAll(view: WebView, css: string): Promise<number> {
  const buttons = await view.findWebElements(By.css(css)).catch(() => []);
  let clicked = 0;
  for (const b of buttons) {
    await b
      .click()
      .then(() => clicked++)
      .catch(() => undefined);
  }
  return clicked;
}

describe("VynorAI large task through the extension", function () {
  this.timeout(LIMIT_MS + 5 * 60_000);
  let view: WebView | undefined;

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("runs the task to the end", async () => {
    const at = process.env.LARGE_TASK_DIR ?? "";
    const task = JSON.parse(
      fs.readFileSync(path.join(at, "task.json"), "utf8"),
    );
    await openWorkspace(task.dir);
    // The profile is signed in once (LARGE_TASK_SIGNIN=1); the key then stays in
    // the profile's secret storage. Signing in on every run is the step that
    // stopped the window from answering, so it is not part of a task run.
    if (process.env.LARGE_TASK_SIGNIN === "1") {
      await signIn();
      console.log("LARGE_TASK_SIGNED_IN");
    }
    ({ view } = await openPanel());
    await retry(async () => {
      const model = await view!.findWebElement(
        By.css("[data-testid='model-select-button']"),
      );
      if ((await model.getText()).trim() !== "VynorAI Auto") {
        throw new Error("model still loading");
      }
    }, 90_000);
    await selectMode(view, "Agent");
    console.log("LARGE_TASK_READY");

    const creditsBefore = await creditsUsed().catch(() => NaN);
    const started = Date.now();
    let approvals = 0;
    let continues = 0;
    let idleSince = 0;
    let everStreamed = false;
    let end = "time limit";
    const log = (m: string) =>
      fs.appendFileSync(
        path.join(at, "progress.log"),
        `${Math.round((Date.now() - started) / 1000)}s ${m}
`,
      );
    log("sending prompt");
    await within(send(view, task.prompt), 60_000, "send");
    log("prompt sent");
    let lastLog = 0;
    try {
      while (Date.now() - started < LIMIT_MS) {
        await sleep(1_000);
        approvals += await within(
          clickAll(view, "[data-testid*='accept-tool-call-button']"),
          30_000,
          "approve buttons",
        );
        const pressed = await within(
          clickAll(view, "[data-testid='continue-task-button']"),
          30_000,
          "continue button",
        );
        continues += pressed;
        const streaming = await isStreaming(view).catch(() => false);
        if (Date.now() - lastLog > 10_000) {
          lastLog = Date.now();
          log(
            `streaming=${streaming} approvals=${approvals} continues=${continues} ${await within(turnStateSnapshot(view), 15_000, "snapshot").catch((e) => String(e.message))}`,
          );
        }
        if (streaming || pressed) {
          everStreamed ||= streaming;
          idleSince = 0;
          continue;
        }
        if (!everStreamed && Date.now() - started < 30_000) continue;
        idleSince ||= Date.now();
        if (Date.now() - idleSince >= QUIET_MS) {
          end = "finished";
          break;
        }
      }
    } catch (e: any) {
      end = `error: ${e.message}`;
      log(end);
    }
    try {
      await view.switchBack();
      const png = await within(
        view.getDriver().takeScreenshot(),
        20_000,
        "screenshot",
      );
      fs.writeFileSync(path.join(at, "end.png"), png, "base64");
    } catch {}
    const creditsAfter = await within(creditsUsed(), 20_000, "credits").catch(
      () => NaN,
    );
    const run = {
      id: task.id,
      end,
      seconds: Math.round((Date.now() - started) / 1000),
      approvals,
      continues,
      tokens: creditsAfter - creditsBefore,
      reply: end.startsWith("error")
        ? ""
        : (await lastReply(view).catch(() => "")).slice(-1500),
    };
    fs.writeFileSync(path.join(at, "run.json"), JSON.stringify(run, null, 2));
    console.log("LARGE_TASK_RUN", JSON.stringify({ ...run, reply: undefined }));
  });
});
