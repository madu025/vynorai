import fs from "node:fs/promises";
import path from "node:path";
import type { ConsoleMessage, HTTPRequest } from "puppeteer";
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
    page.on("console", (message: ConsoleMessage) => {
      if (["error", "warning"].includes(message.type()))
        errors.push(`${message.type()}: ${message.text()}`.slice(0, 500));
    });
    page.on("pageerror", (error: Error) =>
      errors.push(`pageerror: ${error.message}`.slice(0, 500)),
    );
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
    const report = {
      url: page.url(),
      status: response?.status(),
      viewport,
      metadata,
      consoleErrors: errors.slice(0, 25),
      screenshotPath,
    };
    return [
      {
        name: "Browser QA",
        description: errors.length
          ? "Browser verification completed with findings"
          : "Browser verification passed",
        content: JSON.stringify(report, null, 2),
        status: errors.length ? "Completed with findings" : "Passed",
      },
    ];
  } finally {
    await browser.close();
  }
};
