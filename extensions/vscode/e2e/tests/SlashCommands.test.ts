import { expect } from "chai";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { By, Key, WebView } from "vscode-extension-tester";
import {
  openPanel,
  openWorkspace,
  pageText,
  retry,
  sleep,
  waitForTurnEnd,
} from "../smart/gui";

/**
 * Live check of the commands that run locally in the extension (no model, no
 * API key): /status and /memory, against a real folder with instruction files.
 * Covers the real chat input, slash-command menu, core and chat rendering.
 */
function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vynor-e2e-project-"));
  fs.mkdirSync(path.join(dir, "docs"));
  fs.mkdirSync(path.join(dir, "pkg"));
  fs.writeFileSync(path.join(dir, "docs", "style.md"), "Use two spaces.\n");
  fs.writeFileSync(
    path.join(dir, "AGENTS.md"),
    "# Project rules\nFollow @docs/style.md for formatting.\n",
  );
  fs.writeFileSync(
    path.join(dir, "pkg", "CLAUDE.md"),
    "# Package notes\nKeep it small.\n",
  );
  fs.writeFileSync(
    path.join(dir, "CLAUDE.local.md"),
    "# My notes\nPrefer short answers.\n",
  );
  fs.mkdirSync(path.join(dir, ".claude", "skills", "e2e-checklist"), {
    recursive: true,
  });
  fs.writeFileSync(
    path.join(dir, ".claude", "skills", "e2e-checklist", "SKILL.md"),
    "---\nname: e2e-checklist\ndescription: Release checklist for the e2e project\n---\nStep one.\n",
  );
  fs.mkdirSync(path.join(dir, ".claude", "agents"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "agents", "sec-reviewer.md"),
    "---\nname: sec-reviewer\ndescription: Reviews code for security problems\ntools: Read, Grep, Bash\n---\nYou review code for security problems.\n",
  );
  fs.writeFileSync(
    path.join(dir, ".claude", "agents", "broken.md"),
    "---\nname: Not Valid\ndescription: bad name\n---\nbody\n",
  );
  fs.writeFileSync(
    path.join(dir, "package.json"),
    '{"name":"vynor-e2e-project"}\n',
  );
  // A real git repository: one commit, then one modified and one new file.
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "e2e@example.com");
  git("config", "user.name", "E2E");
  git("add", ".");
  git("commit", "-q", "-m", "e2e initial commit");
  fs.writeFileSync(path.join(dir, "package.json"), '{"name":"changed"}\n');
  fs.writeFileSync(path.join(dir, "scratch.txt"), "new\n");
  return dir;
}

/**
 * Slash commands come from the loaded config, and the project chip needs the
 * workspace snapshot. Typing "/" before both are ready shows only "Create a
 * prompt". Wait until the panel has finished loading.
 */
async function waitUntilLoaded(view: WebView) {
  await retry(async () => {
    const model = await view.findWebElement(
      By.css("[data-testid='model-select-button']"),
    );
    const modelText = (await model.getText()).trim();
    const text = await pageText(view);
    if (modelText !== "VynorAI Auto") {
      throw new Error(`model still loading: ${modelText}`);
    }
    if (/Detecting workspace|No workspace/.test(text)) {
      throw new Error("workspace still loading");
    }
  }, 90_000);
}

/** The chat input re-renders as a turn starts and ends, so never reuse an element. */
async function typeIntoInput(view: WebView, ...keys: string[]) {
  await retry(async () => {
    const editors = await view.findWebElements(By.className("tiptap"));
    if (!editors.length) throw new Error("no input");
    // Earlier messages render read-only editors above; the live input is last.
    const input = editors[editors.length - 1];
    await input.click();
    await input.sendKeys(...keys);
  }, 30_000);
}

async function runSlashCommand(view: WebView, name: string) {
  await typeIntoInput(view, `/${name}`);
  await sleep(1_000);
  await typeIntoInput(view, Key.ENTER); // pick the command from the slash menu
  await sleep(500);
  await typeIntoInput(view, Key.ENTER); // submit it
}

/** Picks the command from the menu, then types its argument before submitting. */
async function runSlashCommandWithArg(
  view: WebView,
  name: string,
  arg: string,
) {
  await typeIntoInput(view, `/${name}`);
  await sleep(1_000);
  await typeIntoInput(view, Key.ENTER); // pick the command from the slash menu
  await sleep(500);
  await typeIntoInput(view, ` ${arg}`);
  await sleep(300);
  await typeIntoInput(view, Key.ENTER); // submit it
}

async function waitForText(view: WebView, needle: string, timeoutMs = 60_000) {
  return retry(async () => {
    const text = await pageText(view);
    if (!text.includes(needle)) {
      throw new Error(`"${needle}" not shown yet`);
    }
    return text;
  }, timeoutMs);
}

describe("VynorAI local slash commands", function () {
  this.timeout(240_000);

  let view: WebView | undefined;
  let project = "";

  before(() => {
    project = makeProject();
  });

  afterEach(async () => {
    await view?.switchBack().catch(() => undefined);
  });

  it("lists, runs /status and /memory in one panel session", async () => {
    await openWorkspace(project);
    ({ view } = await openPanel());
    await waitUntilLoaded(view);

    // 1. The slash menu offers the built-in commands.
    await typeIntoInput(view, "/");
    await sleep(1_500);
    const menu = await pageText(view);
    console.log("SLASH MENU TEXT:", JSON.stringify(menu.slice(0, 700)));
    for (const name of [
      "init",
      "status",
      "memory",
      "help",
      "clear",
      "compact",
      "plan",
      "resume",
      "rewind",
      "model",
      "cost",
      "agents",
      "permissions",
      "e2e-checklist",
      // Task shortcuts that run as agent turns (YAML configs used to drop them).
      "fix",
      "explain",
      "test",
      "refactor",
      "docs",
      "review",
      "security",
      "optimize",
      "scaffold",
      "commit",
    ]) {
      expect(menu).to.include(name);
    }
    await typeIntoInput(view, Key.ESCAPE);
    await typeIntoInput(view, Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE);

    // 2. /status reports the project, model, index and instruction files.
    await runSlashCommand(view, "status");
    const status = await waitForText(view, "VynorAI status");
    console.log("STATUS OUTPUT:", JSON.stringify(status.slice(0, 900)));
    expect(status).to.include(`Active project: ${path.basename(project)}`);
    expect(status).to.match(/Chat model: /);
    expect(status).to.match(/Codebase index: (enabled|disabled)/);
    expect(status).to.match(/Instruction files loaded: [1-9]/);
    expect(status).to.include("Git: 2 changed file(s)");
    expect(status).to.include("e2e initial commit");
    expect(status).not.to.include(os.tmpdir());

    // The first turn must be finished before the next command is submitted.
    await waitForTurnEnd(view);

    // 3. /memory lists AGENTS.md and the nested CLAUDE.md, relative paths only.
    await runSlashCommand(view, "memory");
    const memory = await waitForText(view, "Loaded instructions");
    console.log("MEMORY OUTPUT:", JSON.stringify(memory.slice(0, 1200)));
    expect(memory).to.include("AGENTS.md");
    expect(memory).to.include("pkg/CLAUDE.md");
    expect(memory).to.include("CLAUDE.local.md");
    expect(memory).not.to.include(os.tmpdir());

    await waitForTurnEnd(view);

    // 4. /help lists the commands, /plan switches mode, /clear starts a new chat.
    await runSlashCommand(view, "help");
    const help = await waitForText(view, "VynorAI commands");
    console.log("HELP OUTPUT:", JSON.stringify(help.slice(0, 900)));
    expect(help).to.include("/status");
    expect(help).to.include("/clear");
    await waitForTurnEnd(view);

    await runSlashCommand(view, "plan");
    await retry(async () => {
      const mode = await view!.findWebElement(
        By.css("[data-testid='mode-select-button']"),
      );
      const label = (await mode.getAttribute("textContent")).trim();
      if (!/plan/i.test(label)) throw new Error(`mode is still ${label}`);
    }, 30_000);

    await runSlashCommand(view, "clear");
    await retry(async () => {
      const text = await pageText(view!);
      if (text.includes("VynorAI commands")) {
        throw new Error("old conversation is still shown");
      }
    }, 30_000);

    // 5. /agents lists custom subagents (read-only), /permissions switches mode.
    await runSlashCommand(view, "agents");
    const agentsText = await waitForText(view, "Custom agents");
    console.log("AGENTS OUTPUT:", JSON.stringify(agentsText.slice(0, 700)));
    expect(agentsText).to.include("sec-reviewer");
    expect(agentsText).to.include("read-only: Bash");
    expect(agentsText).to.include("Not Valid");
    await waitForTurnEnd(view);

    const closeDialog = async () => {
      const buttons = await view!.findWebElements(
        By.xpath(
          "//*[@hidden=false or not(@hidden)]//button[.//*[name()='svg']]",
        ),
      );
      // the dialog's close button is the first button inside the dialog cover
      const cover = await view!.findWebElements(
        By.css("[tabindex='-1'] > div > button"),
      );
      await (cover[0] ?? buttons[0]).click();
    };

    // /rewind chat removes the last prompt from the conversation, files untouched.
    await runSlashCommandWithArg(view, "rewind", "chat");
    await retry(async () => {
      const text = await pageText(view!);
      if (text.includes("Custom agents")) {
        throw new Error("the /agents turn is still in the conversation");
      }
    }, 30_000);
    // Rewind puts the prompt back in the input box so it can be edited; clear it.
    await typeIntoInput(view, Key.chord(Key.CONTROL, "a"), Key.BACK_SPACE);
    // an unknown number is explained, not ignored
    await runSlashCommandWithArg(view, "rewind", "9");
    await waitForText(view, "There");
    await closeDialog();

    // 6. /model and /cost open a small dialog; /resume opens History.

    await runSlashCommand(view, "model");
    const models = await waitForText(view, "Chat models");
    console.log("MODEL OUTPUT:", JSON.stringify(models.slice(0, 400)));
    expect(models).to.include("Use /model <name> to switch.");
    await closeDialog();

    await runSlashCommand(view, "permissions");
    await waitForText(view, "Mode:");
    await closeDialog();

    await runSlashCommand(view, "cost");
    const cost = await waitForText(view, "This chat:");
    console.log("COST OUTPUT:", JSON.stringify(cost.slice(0, 400)));
    await closeDialog();

    await runSlashCommand(view, "resume");
    await retry(async () => {
      const search = await view!.findWebElements(
        By.css("input[placeholder='Search past sessions']"),
      );
      if (!search.length) throw new Error("History page is not open");
    }, 30_000);
  });
});
