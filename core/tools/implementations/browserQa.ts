import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import type { ConsoleMessage, HTTPRequest, HTTPResponse } from "puppeteer";
// @ts-ignore - package does not publish declarations
import PCR from "puppeteer-chromium-resolver";
import { ToolImpl } from ".";
import { getContinueUtilsPath } from "../../util/paths";
import { getStringArg } from "../parseArgs";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 390, height: 844 },
} as const;

const ACTION_TYPES = ["click", "type", "select", "waitFor", "press"] as const;
type ActionType = (typeof ACTION_TYPES)[number];
export interface BrowserQaAction {
  type: ActionType;
  selector: string;
  value?: string;
  timeoutMs: number;
}

export function parseBrowserQaActions(value: unknown): BrowserQaAction[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 20)
    throw new Error("Browser QA actions must be an array of at most 20 items.");
  return value.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object")
      throw new Error(`Browser QA action ${index + 1} is invalid.`);
    const item = candidate as Record<string, unknown>;
    if (!ACTION_TYPES.includes(item.type as ActionType))
      throw new Error(
        `Browser QA action ${index + 1} has an unsupported type.`,
      );
    if (
      typeof item.selector !== "string" ||
      !item.selector.trim() ||
      item.selector.length > 500
    )
      throw new Error(`Browser QA action ${index + 1} needs a valid selector.`);
    if (
      ["type", "select", "press"].includes(item.type as string) &&
      (typeof item.value !== "string" || item.value.length > 4000)
    )
      throw new Error(`Browser QA action ${index + 1} needs a bounded value.`);
    const timeoutMs =
      item.timeoutMs === undefined ? 3000 : Number(item.timeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 5000)
      throw new Error(`Browser QA action ${index + 1} has an invalid timeout.`);
    return {
      type: item.type as ActionType,
      selector: item.selector,
      value: item.value as string | undefined,
      timeoutMs,
    };
  });
}

export function browserQaBaselineKey(url: URL, viewportName: string): string {
  return createHash("sha256")
    .update(`${url.origin}${url.pathname}|${viewportName}`)
    .digest("hex");
}

export function redactBrowserQaUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return "invalid-url";
  }
}

export function validateBrowserQaUrl(rawUrl: string): URL {
  const url = new URL(rawUrl);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Browser QA accepts credential-free HTTP(S) URLs only.");
  }
  return url;
}

export const browserQaImpl: ToolImpl = async (args) => {
  const rawUrl = getStringArg(args, "url");
  const initial = validateBrowserQaUrl(rawUrl);
  const viewportName = getStringArg(args, "viewport", false) || "desktop";
  const viewport =
    VIEWPORTS[viewportName as keyof typeof VIEWPORTS] ?? VIEWPORTS.desktop;
  const actions = parseBrowserQaActions(args?.actions);
  const baselineMode = ["record", "compare"].includes(args?.baseline)
    ? (args.baseline as "record" | "compare")
    : "none";
  const stats = await PCR({});
  const browser = await stats.puppeteer.launch({
    executablePath: stats.executablePath,
    headless: true,
    args: ["--no-first-run", "--disable-background-networking"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    const errors: string[] = [];
    const networkFindings: string[] = [];
    page.on("console", (message: ConsoleMessage) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(`${message.type()}: ${message.text()}`.slice(0, 500));
    });
    page.on("pageerror", (error: Error) =>
      errors.push(`pageerror: ${error.message}`.slice(0, 500)),
    );
    page.on("requestfailed", (request: HTTPRequest) => {
      networkFindings.push(
        `failed ${request.method()} ${redactBrowserQaUrl(request.url())}: ${request.failure()?.errorText ?? "unknown"}`.slice(
          0,
          500,
        ),
      );
    });
    page.on("response", (networkResponse: HTTPResponse) => {
      if (networkResponse.status() >= 400)
        networkFindings.push(
          `${networkResponse.status()} ${networkResponse.request().method()} ${redactBrowserQaUrl(networkResponse.url())}`.slice(
            0,
            500,
          ),
        );
    });
    await page.setRequestInterception(true);
    page.on("request", (request: HTTPRequest) => {
      try {
        const target = new URL(request.url());
        if (request.isNavigationRequest() && target.origin !== initial.origin)
          request.abort();
        else request.continue();
      } catch {
        request.abort();
      }
    });
    const response = await page.goto(initial.href, {
      waitUntil: "networkidle2",
      timeout: 30_000,
    });
    if (new URL(page.url()).origin !== initial.origin)
      throw new Error("Cross-origin navigation was blocked.");
    const actionEvidence: Array<Record<string, unknown>> = [];
    for (const [index, action] of actions.entries()) {
      await page.waitForSelector(action.selector, {
        timeout: action.timeoutMs,
      });
      if (action.type === "click") await page.click(action.selector);
      if (action.type === "type")
        await page.type(action.selector, action.value!);
      if (action.type === "select")
        await page.select(action.selector, action.value!);
      if (action.type === "press") {
        await page.focus(action.selector);
        await page.keyboard.press(action.value! as any);
      }
      if (new URL(page.url()).origin !== initial.origin)
        throw new Error(
          `Action ${index + 1} attempted cross-origin navigation.`,
        );
      actionEvidence.push({
        step: index + 1,
        type: action.type,
        selector: action.selector,
        status: "passed",
      });
    }
    const metadata = await page.evaluate(() => ({
      title: document.title,
      language: document.documentElement.lang || "unspecified",
      headings: document.querySelectorAll("h1").length,
      imagesWithoutAlt: [...document.images].filter(
        (image) => !image.hasAttribute("alt"),
      ).length,
      unlabeledInputs: [
        ...document.querySelectorAll("input,select,textarea"),
      ].filter(
        (element) =>
          !element.getAttribute("aria-label") &&
          !(element as HTMLInputElement).labels?.length,
      ).length,
    }));
    const directory = path.join(getContinueUtilsPath(), "browser-qa");
    await fs.mkdir(directory, { recursive: true });
    const screenshotPath = path.join(directory, `qa-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const screenshotHash = createHash("sha256")
      .update(await fs.readFile(screenshotPath))
      .digest("hex");
    const baselinePath = path.join(
      directory,
      `baseline-${browserQaBaselineKey(initial, viewportName)}.json`,
    );
    let previousHash: string | undefined;
    if (baselineMode === "compare") {
      try {
        previousHash = JSON.parse(await fs.readFile(baselinePath, "utf8")).hash;
      } catch {
        // A missing baseline is explicit evidence, not an implicit pass.
      }
    }
    if (baselineMode === "record")
      await fs.writeFile(
        baselinePath,
        JSON.stringify(
          {
            hash: screenshotHash,
            url: redactBrowserQaUrl(initial.href),
            viewport,
          },
          null,
          2,
        ),
        "utf8",
      );
    const baseline = {
      mode: baselineMode,
      currentHash: screenshotHash,
      ...(baselineMode === "record" ? { recorded: true } : {}),
      ...(baselineMode === "compare"
        ? {
            found: Boolean(previousHash),
            matched: previousHash === screenshotHash,
          }
        : {}),
    };
    const report = {
      url: redactBrowserQaUrl(page.url()),
      status: response?.status(),
      viewport,
      metadata,
      actions: actionEvidence,
      consoleErrors: errors.slice(0, 25),
      networkFindings: networkFindings.slice(0, 25),
      screenshotPath,
      baseline,
    };
    const hasFindings =
      errors.length > 0 ||
      networkFindings.length > 0 ||
      (baselineMode === "compare" && previousHash !== screenshotHash);
    return [
      {
        name: "Browser QA",
        description: hasFindings
          ? "Browser verification completed with findings"
          : "Browser verification passed",
        content: JSON.stringify(report, null, 2),
        status: hasFindings ? "Completed with findings" : "Passed",
      },
    ];
  } finally {
    await browser.close();
  }
};
