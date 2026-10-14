import * as fs from "node:fs";
import * as path from "node:path";
import { expect } from "chai";
import { By, WebView } from "vscode-extension-tester";
import {
  attachToPanel,
  executeWorkbenchCommand,
  lastReply,
  newSession,
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
import { resetWorkspace } from "../smart/project";

function configPath(): string {
  const root = process.env.CONTINUE_GLOBAL_DIR;
  if (!root) throw new Error("CONTINUE_GLOBAL_DIR is required");
  return path.join(path.resolve(root), "config.json");
}

function setUnreachableEndpoint(): void {
  const file = configPath();
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const models = (config.models ?? []).filter(
    (model: any) => model?.provider === "vynorai",
  );
  if (!models.length) throw new Error("No VynorAI model in persisted config");
  for (const model of models) model.apiBase = "http://127.0.0.1:1/v1";
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);

  // config.yaml is the profile source of truth; reloadConfig rebuilds the
  // JSON projection from it. Patch both representations for a real offline
  // request instead of silently restoring the production endpoint.
  const yamlFile = path.join(path.dirname(file), "config.yaml");
  const yaml = fs.readFileSync(yamlFile, "utf8");
  fs.writeFileSync(
    yamlFile,
    yaml.replace(
      /apiBase:\s*https:\/\/vynor\.lk\/v1\//g,
      "apiBase: http://127.0.0.1:1/v1/",
    ),
  );
}

function restoreProductionEndpoint(): void {
  const file = configPath();
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const model of config.models ?? []) {
    if (model?.provider === "vynorai") model.apiBase = "https://vynor.lk/v1/";
  }
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  const yamlFile = path.join(path.dirname(file), "config.yaml");
  const yaml = fs.readFileSync(yamlFile, "utf8");
  fs.writeFileSync(
    yamlFile,
    yaml.replace(
      /apiBase:\s*http:\/\/127\.0\.0\.1:1\/v1\//g,
      "apiBase: https://vynor.lk/v1/",
    ),
  );
}

describe("VynorAI offline recovery", function () {
  this.timeout(180_000);
  let view: WebView | undefined;

  afterEach(async function () {
    this.timeout(10_000);
    await view?.switchBack().catch(() => undefined);
  });

  it("reports a truthful network failure without completing the task", async () => {
    await openWorkspace(resetWorkspace());
    await signIn();
    await sleep(5_000);
    await executeWorkbenchCommand("continue.newSession");
    ({ view } = await openPanel());
    await selectMode(view, "Agent");

    // Change only the persisted endpoint, then use the normal config reload
    // command so the request exercises the real provider path.
    setUnreachableEndpoint();
    await view.switchBack();
    await executeWorkbenchCommand("continue.reloadConfig");
    // The sign-in migration runs asynchronously on first activation and can
    // rewrite the profile once more. Re-apply after that lifecycle point, then
    // reload again so the model instance is definitely pointed at loopback.
    await sleep(1_000);
    setUnreachableEndpoint();
    await executeWorkbenchCommand("continue.reloadConfig");
    // A failed provider config can temporarily omit the mode selector while
    // the React config state settles. The mode was already set to Agent above;
    // wait only for the real editor and exercise the request path directly.
    ({ view } = await attachToPanel("[contenteditable='true']"));

    await send(
      view,
      `Offline network probe ${Date.now()}: reply with the single word offline.`,
    );
    await waitForTurnEnd(view, { timeoutMs: 60_000, quietMs: 2_000 });
    const text = await retry(async () => {
      const value = await pageText(view!);
      if (!/error|connection|network|refused|failed/i.test(value)) {
        throw new Error(
          `network error is not visible yet: ${value.slice(-300)}`,
        );
      }
      return value;
    }, 20_000);
    expect(text).to.match(/error|connection|network|refused|failed/i);
    // "COMPLETION CRITERIA" is normal UI copy even for a failed turn. A
    // receipt is the authoritative completion signal; only reject an actual
    // task/turn success phrase here.
    expect(text).not.to.match(
      /\b(?:task|turn|request)\s+(?:is\s+)?completed\b/i,
    );
    await view
      .findWebElements(By.css("[data-testid='task-receipt']"))
      .then((receipts) => expect(receipts.length).to.equal(0));

    // Restore the real endpoint and prove recovery through the normal config
    // reload path, using a fresh prompt so no cached response can satisfy it.
    restoreProductionEndpoint();
    await view.switchBack();
    await executeWorkbenchCommand("continue.reloadConfig");
    ({ view } = await attachToPanel("[contenteditable='true']"));
    await newSession(view);
    await send(
      view,
      `Online recovery probe ${Date.now()}: reply with the single word online.`,
    );
    await waitForTurnEnd(view, { timeoutMs: 90_000, quietMs: 2_000 });
    const recovered = await lastReply(view);
    expect(recovered).to.not.match(
      /ECONNREFUSED|connection refused|network error/i,
    );
    expect(recovered.trim()).to.not.equal("");
  });
});
