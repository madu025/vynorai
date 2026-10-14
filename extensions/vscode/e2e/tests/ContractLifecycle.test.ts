import * as fs from "fs";
import * as path from "path";

import { expect } from "chai";
import { By, Key, WebView, Workbench } from "vscode-extension-tester";

import {
  attachToPanel,
  lastReply,
  openPanel,
  openWorkspace,
  pageText,
  retry,
  selectMode,
  send,
  signIn,
  sleep,
  waitForTurnEnd,
} from "../smart/gui";
import { read, resetWorkspace, runProjectTests } from "../smart/project";

type ContractSnapshot = {
  id: string;
  state: string;
  contract?: {
    id: string;
    scope: string;
    criteria: Array<{ id: string; status: string }>;
  };
};

async function typeIntoInput(view: WebView, ...keys: any[]) {
  await retry(async () => {
    const editors = await view.findWebElements(By.className("tiptap"));
    if (!editors.length) throw new Error("no chat input");
    const input = editors[editors.length - 1];
    await input.click();
    await input.sendKeys(...keys);
  }, 30_000);
}

async function runSlashCommandWithArg(
  view: WebView,
  name: string,
  arg: string,
) {
  await typeIntoInput(view, `/${name}`);
  await sleep(1_000);
  await typeIntoInput(view, Key.ENTER);
  await sleep(500);
  await typeIntoInput(view, ` ${arg}`);
  await sleep(300);
  await typeIntoInput(view, Key.ENTER);
}

function taskDirectory(): string {
  const globalDir = process.env.CONTINUE_GLOBAL_DIR;
  if (!globalDir) throw new Error("CONTINUE_GLOBAL_DIR is required");
  return path.join(path.resolve(globalDir), "agent-tasks");
}

function latestContract(): ContractSnapshot {
  const files = fs
    .readdirSync(taskDirectory())
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      mtime: fs.statSync(path.join(taskDirectory(), file)).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime);
  if (!files[0]) throw new Error("No task journal was written");
  const task = JSON.parse(
    fs.readFileSync(path.join(taskDirectory(), files[0].file), "utf8"),
  );
  return {
    id: String(task.id),
    state: String(task.state),
    contract: task.contract
      ? {
          id: String(task.contract.id),
          scope: String(task.contract.scope),
          criteria: Array.isArray(task.contract.criteria)
            ? task.contract.criteria.map((criterion: any) => ({
                id: String(criterion.id),
                status: String(criterion.status),
              }))
            : [],
        }
      : undefined,
  };
}

function savedSessionHasSummary(): boolean {
  const accounts = path.join(
    path.resolve(process.env.CONTINUE_GLOBAL_DIR ?? ""),
    "sessions",
    "accounts",
  );
  if (!fs.existsSync(accounts)) return false;
  for (const account of fs.readdirSync(accounts)) {
    const dir = path.join(accounts, account);
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".json") || file === "sessions.json") continue;
      try {
        const session = JSON.parse(
          fs.readFileSync(path.join(dir, file), "utf8"),
        );
        if (
          Array.isArray(session.history) &&
          session.history.some((item: any) => Boolean(item.conversationSummary))
        ) {
          return true;
        }
      } catch {
        // Ignore a session file while it is being atomically replaced.
      }
    }
  }
  return false;
}

describe("completion contract lifecycle", function () {
  this.timeout(10 * 60_000);

  let view: WebView | undefined;

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("preserves the contract across compact/reload and chat rewind", async () => {
    await openWorkspace(resetWorkspace());
    await signIn();
    await sleep(5_000);
    await new Workbench().executeCommand("continue.newSession");
    ({ view } = await openPanel());
    await retry(async () => {
      const text = await pageText(view!);
      if (/Detecting workspace|No workspace/.test(text))
        throw new Error("workspace is still loading");
    }, 90_000);
    await selectMode(view, "Agent");

    await send(
      view,
      "Add a multiply(a, b) function to math.js, add a test for it, and run the tests.",
    );
    await waitForTurnEnd(view, { timeoutMs: 240_000 });
    await retry(async () => {
      if (!(await lastReply(view!)).trim()) throw new Error("no agent reply");
    }, 30_000);
    expect(runProjectTests().ok, await lastReply(view)).to.equal(true);
    expect(read("math.js")).to.include("multiply");

    const before = latestContract();
    expect(before.contract, "task contract missing").to.exist;
    expect(before.state).to.equal("completed");
    expect(
      before.contract?.criteria.every(
        (criterion) => criterion.status === "passed",
      ),
    ).to.equal(true);

    await runSlashCommandWithArg(
      view,
      "compact",
      "focus on the completed multiply change",
    );
    await retry(async () => {
      if (!savedSessionHasSummary())
        throw new Error("compaction summary was not persisted");
    }, 120_000);
    expect(latestContract()).to.deep.equal(before);

    await view.switchBack();
    await new Workbench().executeCommand("Developer: Reload Window");
    ({ view } = await attachToPanel());
    expect(latestContract()).to.deep.equal(before);

    await runSlashCommandWithArg(view, "rewind", "chat");
    await retry(async () => {
      if (!latestContract().contract)
        throw new Error("contract disappeared after rewind");
    }, 30_000);
    expect(latestContract()).to.deep.equal(before);
  });
});
