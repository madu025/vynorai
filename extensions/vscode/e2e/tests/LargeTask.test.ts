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
  approvalCount,
  creditsUsed,
  isStreaming,
  lastReply,
  newSession,
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
/** Nothing in the journal and nothing on screen for this long: the turn hung. */
const STUCK_MS = 180_000;

/**
 * The newest event of the newest task journal written since `since`. The
 * journal is the extension's own record of where the turn is; the screen alone
 * cannot tell "finished" from "a command is running" or "an approval is
 * pending" (three runs were closed by the driver in those states).
 */
function lastJournalEvent(
  since: number,
): { type: string; state?: string; kind?: string; at: number } | undefined {
  try {
    const dir = path.join(
      path.resolve(process.env.CONTINUE_GLOBAL_DIR ?? ""),
      "agent-tasks",
    );
    const newest = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".events.jsonl"))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .filter((x) => x.t >= since)
      .sort((a, b) => b.t - a.t)[0];
    if (!newest) return undefined;
    const lines = fs
      .readFileSync(path.join(dir, newest.f), "utf8")
      .trim()
      .split("\n");
    const event = JSON.parse(lines[lines.length - 1]);
    return {
      type: event.type,
      state: event.data?.state,
      kind: event.data?.kind,
      at: event.createdAt,
    };
  } catch {
    return undefined;
  }
}

/** The extension ended the turn: finalisation wrote one of these states. */
function journalSaysTurnEnded(
  event: { type: string; state?: string; kind?: string } | undefined,
): boolean {
  // A response verification is terminal only when it was explicitly recorded.
  // A task transition to "verifying" is still waiting for fresh checks or the
  // required independent review; ending the driver there would score a valid
  // product run as a false completion.
  if (event?.type === "verification.recorded" && event.kind === "response")
    return true;
  return (
    event?.type === "task.transitioned" &&
    ["completed", "failed", "canceled"].includes(event.state ?? "")
  );
}

/**
 * A bounded, content-free projection of the task journal for benchmark
 * evidence. The task goal, criterion text and tool output never leave the
 * local profile; only stable IDs, policies and statuses are recorded.
 */
function latestTaskReceipt(since: number):
  | {
      id: string;
      state: string;
      scope?: string;
      criteria: Array<{
        id: string;
        required: boolean;
        policy: string[];
        status: string;
      }>;
      evidence: Array<{ criterionId: string; kind: string; status: string }>;
      verification: Array<{ kind: string; status: string }>;
      mutationGeneration: number;
    }
  | undefined {
  try {
    const dir = path.join(
      path.resolve(process.env.CONTINUE_GLOBAL_DIR ?? ""),
      "agent-tasks",
    );
    const candidates = fs
      .readdirSync(dir)
      .filter((file) => file.endsWith(".json"))
      .map((file) => ({
        file,
        full: path.join(dir, file),
        mtime: fs.statSync(path.join(dir, file)).mtimeMs,
      }))
      .filter((item) => item.mtime >= since)
      .sort((a, b) => b.mtime - a.mtime);
    for (const item of candidates) {
      const task = JSON.parse(fs.readFileSync(item.full, "utf8"));
      if (!task?.id || Number(task.createdAt) < since) continue;
      return {
        id: task.id,
        state: String(task.state ?? "unknown"),
        scope: task.contract?.scope,
        criteria: Array.isArray(task.contract?.criteria)
          ? task.contract.criteria.map((criterion: any) => ({
              id: String(criterion.id),
              required: criterion.required === true,
              policy: Array.isArray(criterion.evidencePolicy)
                ? criterion.evidencePolicy.map(String)
                : [],
              status: String(criterion.status ?? "unknown"),
            }))
          : [],
        evidence: Array.isArray(task.evidence)
          ? task.evidence.map((receipt: any) => ({
              criterionId: String(receipt.criterionId),
              kind: String(receipt.kind),
              status: String(receipt.status),
            }))
          : [],
        verification: Array.isArray(task.verification)
          ? task.verification.map((result: any) => ({
              kind: String(result.kind),
              status: String(result.status),
            }))
          : [],
        mutationGeneration: Number(task.mutationGeneration ?? 0),
      };
    }
  } catch {
    // The runner still records the external result if the local journal is
    // unavailable; the manifest will classify the missing receipt separately.
  }
  return undefined;
}

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

async function clickUnseen(
  view: WebView,
  css: string,
  seen: Set<string>,
): Promise<number> {
  const buttons = await view.findWebElements(By.css(css)).catch(() => []);
  let clicked = 0;
  for (const b of buttons) {
    const id = await b.getAttribute("data-testid").catch(() => "");
    // Historical tool cards retain their approve button in the DOM. Retrying
    // those stale controls forever made the benchmark driver look active after
    // a turn had already stopped. A new tool call has a distinct test id.
    if (!id || seen.has(id)) continue;
    await b
      .click()
      .then(() => {
        seen.add(id);
        clicked++;
      })
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
    console.log("LARGE_TASK_READY");

    const creditsBefore = await creditsUsed().catch(() => NaN);
    const started = Date.now();
    let approvals = 0;
    let continues = 0;
    let idleSince = 0;
    let journalSignature = "";
    let journalChangedAt = Date.now();
    let everStreamed = false;
    let end = "time limit";
    const approvedToolCalls = new Set<string>();
    const pressedContinueButtons = new Set<string>();
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
          clickUnseen(
            view,
            "[data-testid*='accept-tool-call-button']",
            approvedToolCalls,
          ),
          30_000,
          "approve buttons",
        );
        const pressed = await within(
          clickUnseen(
            view,
            "[data-testid='continue-task-button']",
            pressedContinueButtons,
          ),
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
        // A running terminal command (npm install) is not streaming, and the
        // turn is not over: a run was cut off 8 s into an install.
        const commandRunning =
          (
            await view
              .findWebElements(
                By.xpath("//a[normalize-space()='Move to background']"),
              )
              .catch(() => [])
          ).length > 0;
        // A tool call waiting for its approval is not an ended turn either.
        const waiting = await approvalCount(view).catch(() => 0);
        if (streaming || pressed || commandRunning || waiting > 0) {
          everStreamed ||= streaming;
          idleSince = 0;
          continue;
        }
        if (!everStreamed && Date.now() - started < 30_000) continue;
        idleSince ||= Date.now();
        const latest = lastJournalEvent(started - 5_000);
        const signature = latest ? `${latest.type}:${latest.at}` : "";
        if (signature !== journalSignature) {
          journalSignature = signature;
          journalChangedAt = Date.now();
        }
        const idleFor = Date.now() - idleSince;
        if (journalSaysTurnEnded(latest) && idleFor >= QUIET_MS) {
          end = "finished";
          break;
        }
        if (idleFor >= STUCK_MS && Date.now() - journalChangedAt >= STUCK_MS) {
          end =
            `stuck after ${latest?.type ?? "no journal"} ${latest?.state ?? ""}`.trim();
          break;
        }
      }
    } catch (e: any) {
      end = `error: ${e.message}`;
      log(end);
    }
    let reply = "";
    try {
      reply = await within(lastReply(view), 20_000, "last reply").catch(
        () => "",
      );
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
      // Used only by the local scorer to inspect the isolated session
      // metadata. It is not copied into the reproducibility manifest.
      globalDir: path.resolve(process.env.CONTINUE_GLOBAL_DIR ?? ""),
      end,
      seconds: Math.round((Date.now() - started) / 1000),
      approvals,
      continues,
      tokens: creditsAfter - creditsBefore,
      reply: end.startsWith("error") ? "" : reply.slice(-1500),
      taskReceipt: latestTaskReceipt(started),
    };
    fs.writeFileSync(path.join(at, "run.json"), JSON.stringify(run, null, 2));
    console.log("LARGE_TASK_RUN", JSON.stringify({ ...run, reply: undefined }));
  });
});
