import {
  By,
  InputBox,
  Key,
  VSBrowser,
  WebDriver,
  WebElement,
  WebView,
  Workbench,
} from "vscode-extension-tester";

/** VynorAI panel helpers. Waits are state-based (data attributes), not sleeps. */

const API_BASE = process.env.VYNOR_E2E_API_BASE || "https://vynor.lk";

function e2eApiKey() {
  return process.env.VYNORAI_E2E_API_KEY || process.env.VYNOR_E2E_API_KEY || "";
}

export async function openWorkspace(dir: string) {
  await VSBrowser.instance.openResources(dir);
  // Opening a folder can leave the command-palette input in a transient
  // non-interactable state on Windows. Clearing notifications is only test
  // hygiene, so do not fail the suite before sign-in if that cleanup command
  // cannot be dispatched during the short transition.
  await retry(
    () =>
      new Workbench().executeCommand("Notifications: Clear All Notifications"),
    10_000,
  ).catch(() => undefined);
}

/**
 * Sign in exactly as a user with an API key does: the "VynorAI: Set API Key"
 * command and its input box. No test-only code path in the extension.
 */
export async function signIn() {
  const key = e2eApiKey();
  if (!/^vynor_live_[a-f0-9]{32}$/i.test(key))
    throw new Error("VYNORAI_E2E_API_KEY is missing or malformed");
  // Run before activation finishes, the command is only a palette entry: the
  // key would be typed into the palette itself and no sign-in would happen.
  await waitForExtensionActive();
  await retry(async () => {
    await new Workbench().executeCommand("VynorAI: Set API Key");
    const input = await InputBox.create(10_000);
    const placeholder = await input.getPlaceHolder().catch(() => "");
    if (!/vynor_live/i.test(placeholder)) {
      await input.cancel().catch(() => undefined);
      throw new Error(`API key box not shown yet (got "${placeholder}")`);
    }
    await input.setText(key);
    await input.confirm();
  }, 90_000);
  await sleep(3_000); // config reload after sign-in
}

/** Focus the VynorAI panel and switch the driver into its React iframe. */
export async function openPanel(): Promise<{
  view: WebView;
  driver: WebDriver;
}> {
  await waitForExtensionActive();
  await retry(async () => {
    await new Workbench().executeCommand("continue.focusContinueInput");
    await failIfCommandNotFound();
  }, 60_000);
  return attachToPanel();
}

/**
 * The extension bundle is large: loading it takes ~6 s and its commands are
 * registered at the end of activation (~8 s after start). The command palette
 * lists the commands from package.json at once, so running one too early hits
 * "command not found" and leaves a modal error open. Wait for the extension's
 * status bar item, which is created during activation.
 */
async function waitForExtensionActive() {
  await retry(async () => {
    const statusBar = await new Workbench().getStatusBar();
    await statusBar.findElement(By.xpath("//*[contains(., 'VynorAI')]"));
  }, 60_000);
}

/**
 * A command run before activation finishes does not throw: VS Code opens an
 * error dialog. Close it and throw so the caller retries.
 */
async function failIfCommandNotFound() {
  const driver = VSBrowser.instance.driver;
  const dialogs = await driver.findElements(By.css(".monaco-dialog-box"));
  if (dialogs.length === 0) return;
  const text = await dialogs[0].getText();
  const button = await dialogs[0].findElements(
    By.css(".dialog-buttons .monaco-button"),
  );
  if (button.length > 0) await button[0].click();
  if (/not found|resulted in an error/i.test(text)) {
    await sleep(1_000);
    throw new Error(
      `VynorAI command not ready yet: ${text.replace(/\s+/g, " ")}`,
    );
  }
}

/** Attach to an already-open VynorAI panel without changing its route. */
export async function attachToPanel(
  readySelector = "[data-testid='mode-select-button']",
): Promise<{
  view: WebView;
  driver: WebDriver;
}> {
  const view = new WebView();
  const driver = view.getDriver();
  await retry(async () => {
    await driver.switchTo().defaultContent();
    for (const iframe of await driver.findElements(By.css("iframe"))) {
      const src = (await iframe.getAttribute("src")) || "";
      if (/extensionId=vynorai\.vynorai/i.test(src)) {
        await driver.switchTo().frame(iframe);
        const appFrame = await driver.findElement(By.css("iframe"));
        await driver.switchTo().frame(appFrame);
        return;
      }
    }
    throw new Error("VynorAI webview not found");
  }, 30_000);
  // A new session/sign-in can reload the React app asynchronously. Do not
  // query controls while the webview is still on its loading/config state.
  await waitForUiReady(view, readySelector);
  return { view, driver };
}

async function waitForUiReady(view: WebView, readySelector: string) {
  await retry(async () => {
    await view.findWebElement(By.css(readySelector));
    if (readySelector === "[data-testid='mode-select-button']") {
      await view.findWebElement(By.className("tiptap"));
    }
  }, 60_000);
}

export async function newSession(view: WebView) {
  const button = await retry(() =>
    view.findWebElement(By.css("[data-testid='new-session-button']")),
  ).catch(() => undefined);
  if (button) await button.click();
}

export async function selectMode(view: WebView, label: string) {
  await retry(async () => {
    const dropdown = await view.findWebElement(
      By.css("[data-testid='mode-select-button']"),
    );
    const currentLabel = (await dropdown.getText()).trim();
    if (currentLabel === label) return;
    const option = await view
      .findWebElement(
        By.xpath(`//*[@role="listbox"]//*[contains(text(), "${label}")]`),
      )
      .catch(() => undefined);
    if (option) {
      await option.click();
      return;
    }
    await dropdown.click();
    await sleep(500);
    throw new Error(`mode option ${label} is not rendered yet`);
  }, 30_000);
}

export async function send(view: WebView, text: string) {
  const editor = await retry(async () => {
    const editors = await view.findWebElements(By.className("tiptap"));
    if (!editors.length) throw new Error("no input");
    const candidate = editors[0];
    // The compact toolbar can briefly overlap the editor while a new session
    // settles. Retry the click itself, not only the element lookup.
    await candidate.click();
    return candidate;
  }, 60_000);
  await editor.sendKeys(text);
  await editor.sendKeys(Key.ENTER);
}

export async function isStreaming(view: WebView): Promise<boolean> {
  const steps = await withTimeout(
    view.findWebElement(By.css("[data-testid='chat-steps']")),
    5_000,
    "reading chat streaming state",
  );
  return (await steps.getAttribute("data-streaming")) === "true";
}

/**
 * Wait until the turn has started and then stayed idle for `quietMs`
 * (tool calls continue the turn, so one idle sample is not enough).
 */
export async function waitForTurnEnd(
  view: WebView,
  { timeoutMs = 240_000, quietMs = 4_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let started = false;
  let idleSince = 0;
  let lastSnapshot = "";
  let lastSnapshotAt = 0;
  while (Date.now() < deadline) {
    const streaming = await isStreaming(view).catch(() => false);
    const approvals = await approvalCount(view);
    if (Date.now() - lastSnapshotAt >= 2_000) {
      lastSnapshot = await turnStateSnapshot(view);
      lastSnapshotAt = Date.now();
    }
    if (streaming) {
      started = true;
      idleSince = 0;
    } else if (approvals > 0) {
      return; // waiting on the user is a stable end state
    } else if (started || Date.now() > deadline - timeoutMs + 15_000) {
      idleSince ||= Date.now();
      if (Date.now() - idleSince >= quietMs) return;
    }
    await sleep(500);
  }
  throw new Error(
    `turn did not finish within ${timeoutMs / 1000}s; state=${lastSnapshot}`,
  );
}

/** Compact, redacted state captured when a real-agent turn does not settle. */
export async function turnStateSnapshot(view: WebView): Promise<string> {
  const steps = await withTimeout(
    view.findWebElement(By.css("[data-testid='chat-steps']")),
    2_000,
    "reading chat steps for diagnostics",
  ).catch(() => undefined);
  const streaming = steps
    ? await steps.getAttribute("data-streaming").catch(() => "unreadable")
    : "missing";
  const approvals = await approvalCount(view);
  const replies = await view
    .findWebElements(By.css("[data-testid='assistant-message']"))
    .catch(() => [] as WebElement[]);
  const lastReplyText = replies.length
    ? (await replies[replies.length - 1].getText().catch(() => ""))
        .replace(/\s+/g, " ")
        .slice(-240)
    : "";
  const stepText = steps
    ? (await steps.getText().catch(() => "")).replace(/\s+/g, " ").slice(-240)
    : "";
  return JSON.stringify({ streaming, approvals, stepText, lastReplyText });
}

export async function approvalCount(view: WebView): Promise<number> {
  return (
    await withTimeout(
      view.findWebElements(By.css("[data-testid*='accept-tool-call-button']")),
      5_000,
      "reading approval buttons",
    ).catch(() => [] as WebElement[])
  ).length;
}

export async function lastReply(view: WebView): Promise<string> {
  const replies = await view.findWebElements(
    By.css("[data-testid='assistant-message']"),
  );
  return replies.length ? await replies[replies.length - 1].getText() : "";
}

export async function pageText(view: WebView): Promise<string> {
  return (await view.findWebElement(By.css("body"))).getText();
}

export async function clickStop(view: WebView) {
  const stop = await retry(
    () => view.findWebElement(By.css("[data-testid='stop-button']")),
    10_000,
  );
  await stop.click();
}

export async function creditsUsed(): Promise<number> {
  const response = await fetch(`${API_BASE}/v1/usage`, {
    headers: { authorization: `Bearer ${e2eApiKey()}` },
  });
  const data: any = await response.json();
  return Number(data?.tokens?.used ?? 0);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function retry<T>(
  fn: () => Promise<T>,
  timeoutMs = 15_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: unknown;
  while (Date.now() < deadline) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      await sleep(400);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
