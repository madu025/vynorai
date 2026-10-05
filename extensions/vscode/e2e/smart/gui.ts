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

export async function openWorkspace(dir: string) {
  await VSBrowser.instance.openResources(dir);
  await new Workbench().executeCommand(
    "Notifications: Clear All Notifications",
  );
}

/**
 * Sign in exactly as a user with an API key does: the "VynorAI: Set API Key"
 * command and its input box. No test-only code path in the extension.
 */
export async function signIn() {
  const key = process.env.VYNORAI_E2E_API_KEY || "";
  if (!/^vynor_live_[a-f0-9]{32}$/i.test(key))
    throw new Error("VYNORAI_E2E_API_KEY is missing or malformed");
  await new Workbench().executeCommand("VynorAI: Set API Key");
  const input = await retry(() => InputBox.create(10_000));
  await input.setText(key);
  await input.confirm();
  await sleep(3_000); // config reload after sign-in
}

/** Focus the VynorAI panel and switch the driver into its React iframe. */
export async function openPanel(): Promise<{
  view: WebView;
  driver: WebDriver;
}> {
  await retry(() =>
    new Workbench().executeCommand("continue.focusContinueInput"),
  );
  const view = new WebView();
  const driver = view.getDriver();
  await driver.switchTo().defaultContent();
  const frame = await retry(async () => {
    for (const iframe of await driver.findElements(By.css("iframe"))) {
      const src = (await iframe.getAttribute("src")) || "";
      if (/extensionId=vynorai\.vynorai/i.test(src)) return iframe;
    }
    throw new Error("VynorAI webview not found");
  }, 30_000);
  await driver.switchTo().frame(frame);
  await driver.switchTo().frame(await driver.findElement(By.css("iframe")));
  return { view, driver };
}

export async function newSession(view: WebView) {
  const button = await retry(() =>
    view.findWebElement(By.css("[data-testid='new-session-button']")),
  ).catch(() => undefined);
  if (button) await button.click();
}

export async function selectMode(view: WebView, label: string) {
  const dropdown = await retry(() =>
    view.findWebElement(By.css("[data-testid='mode-select-button']")),
  ).catch(() => undefined);
  if (!dropdown) return;
  await dropdown.click();
  const option = await retry(() =>
    view.findWebElement(
      By.xpath(`//*[@role="listbox"]//*[contains(text(), "${label}")]`),
    ),
  );
  await option.click();
}

export async function send(view: WebView, text: string) {
  const editor = await retry(async () => {
    const editors = await view.findWebElements(By.className("tiptap"));
    if (!editors.length) throw new Error("no input");
    return editors[0];
  });
  await editor.click();
  await editor.sendKeys(text);
  await editor.sendKeys(Key.ENTER);
}

export async function isStreaming(view: WebView): Promise<boolean> {
  const steps = await view.findWebElement(By.css("[data-testid='chat-steps']"));
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
  while (Date.now() < deadline) {
    const streaming = await isStreaming(view).catch(() => false);
    const approvals = await approvalCount(view);
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
  throw new Error(`turn did not finish within ${timeoutMs / 1000}s`);
}

export async function approvalCount(view: WebView): Promise<number> {
  return (
    await view
      .findWebElements(By.css("[data-testid*='accept-tool-call-button']"))
      .catch(() => [] as WebElement[])
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
    headers: { authorization: `Bearer ${process.env.VYNORAI_E2E_API_KEY}` },
  });
  const data: any = await response.json();
  return Number(data?.tokens?.used ?? 0);
}

export function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
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
