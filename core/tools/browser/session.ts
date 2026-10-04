/**
 * One persistent browser for the agent (and the IDE's live Browser panel).
 *
 * Uses the system Chrome or Edge when installed (no download), else the
 * bundled Chromium resolver. Headless, with a CDP screencast that the
 * VS Code "VynorAI Browser" panel renders live, so the user watches and can
 * click along. Closes itself after 10 idle minutes.
 *
 * The agent reads pages as text snapshots: interactive elements get short
 * refs (e1, e2, ...) it can click or type into, so text-only models work too.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  Browser,
  CDPSession,
  ConsoleMessage,
  HTTPRequest,
  HTTPResponse,
  Page,
} from "puppeteer";

import { getContinueUtilsPath } from "../../util/paths";

export interface BrowserLogEntry {
  kind: "console" | "error" | "network";
  level: string;
  text: string;
  at: number;
}

const MAX_LOGS = 300;
const IDLE_CLOSE_MS = 10 * 60_000;
export const VIEWPORT = { width: 1280, height: 800 };

// Bundlers (esbuild keepNames) wrap nested functions in __name(), which does
// not exist inside the page; define it as a no-op before evaluating our code.
const PAGE_HELPERS =
  "window.__name = window.__name || function (f) { return f; };";

function systemBrowserPath(): string | undefined {
  const candidates =
    process.platform === "win32"
      ? [
          path.join(
            process.env["PROGRAMFILES"] ?? "C:\\Program Files",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["LOCALAPPDATA"] ?? "",
            "Google\\Chrome\\Application\\chrome.exe",
          ),
          path.join(
            process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
          path.join(
            process.env["PROGRAMFILES"] ?? "C:\\Program Files",
            "Microsoft\\Edge\\Application\\msedge.exe",
          ),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/google-chrome-stable",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
            "/snap/bin/chromium",
          ];
  return candidates.find((p) => p && fs.existsSync(p));
}

export function validateBrowserUrl(raw: string): URL {
  const url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("The browser opens credential-free http(s) URLs only.");
  return url;
}

export function isLocalUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const host = new URL(raw).hostname;
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "[::1]" ||
      host.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export class BrowserSession extends EventEmitter {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdp: CDPSession | null = null;
  private launching: Promise<Page> | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private logs: BrowserLogEntry[] = [];
  private lastFrame: { data: string; width: number; height: number } | null =
    null;

  get isOpen(): boolean {
    return this.page !== null;
  }

  get currentUrl(): string | undefined {
    return this.page?.url();
  }

  get frame() {
    return this.lastFrame;
  }

  getLogs(kind?: BrowserLogEntry["kind"], limit = 40): BrowserLogEntry[] {
    const list = kind ? this.logs.filter((l) => l.kind === kind) : this.logs;
    return list.slice(-limit);
  }

  private log(entry: Omit<BrowserLogEntry, "at">) {
    const full = { ...entry, text: entry.text.slice(0, 600), at: Date.now() };
    this.logs.push(full);
    if (this.logs.length > MAX_LOGS) this.logs.shift();
    this.emit("log", full);
  }

  private touch() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => void this.close(), IDLE_CLOSE_MS);
    this.idleTimer.unref?.();
  }

  /** Returns the open page, launching the browser if needed. */
  async ensure(): Promise<Page> {
    this.touch();
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.launching)
      this.launching = this.launch().finally(() => (this.launching = null));
    return this.launching;
  }

  private async launch(): Promise<Page> {
    const puppeteer = (await import("puppeteer")).default;
    let executablePath = systemBrowserPath();
    if (!executablePath) {
      // @ts-ignore - package does not publish declarations
      const PCR = (await import("puppeteer-chromium-resolver")).default;
      executablePath = (await PCR({})).executablePath;
    }
    const userDataDir = path.join(os.tmpdir(), "vynorai-browser-profile");
    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
      userDataDir,
      defaultViewport: VIEWPORT,
      args: [
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
      ],
    });
    this.browser.on("disconnected", () => this.reset());
    const [first] = await this.browser.pages();
    const page = first ?? (await this.browser.newPage());
    this.attach(page);
    await page.evaluateOnNewDocument(PAGE_HELPERS);
    this.page = page;
    await this.startScreencast(page);
    this.emit("state", { open: true, launched: true, url: page.url() });
    return page;
  }

  private attach(page: Page) {
    page.on("console", (m: ConsoleMessage) => {
      const level = m.type();
      if (!["error", "warn", "warning", "log", "info"].includes(level)) return;
      // Name the source: third-party frames (e.g. Cloudflare Turnstile) log
      // noise that is not the page's own code.
      let src = "";
      try {
        const u = m.location()?.url;
        const origin = u ? new URL(u).origin : "";
        if (origin && origin !== new URL(page.url()).origin)
          src = ` (from ${origin}, third-party)`;
      } catch {}
      this.log({ kind: "console", level, text: m.text() + src });
    });
    page.on("pageerror", (e: unknown) =>
      this.log({
        kind: "error",
        level: "error",
        text: e instanceof Error ? e.message : String(e),
      }),
    );
    page.on("requestfailed", (r: HTTPRequest) => {
      const reason = r.failure()?.errorText ?? "failed";
      if (reason === "net::ERR_ABORTED") return;
      this.log({
        kind: "network",
        level: "error",
        text: `${r.method()} ${r.url()} → ${reason}`,
      });
    });
    page.on("response", (r: HTTPResponse) => {
      if (r.status() >= 400)
        this.log({
          kind: "network",
          level: r.status() >= 500 ? "error" : "warn",
          text: `${r.status()} ${r.request().method()} ${r.url()}`,
        });
    });
    page.on("framenavigated", (f) => {
      if (f === page.mainFrame())
        this.emit("state", { open: true, url: page.url() });
    });
  }

  private async startScreencast(page: Page) {
    try {
      this.cdp = await page.createCDPSession();
      this.cdp.on("Page.screencastFrame", (evt: any) => {
        this.lastFrame = {
          data: evt.data,
          width: evt.metadata?.deviceWidth ?? VIEWPORT.width,
          height: evt.metadata?.deviceHeight ?? VIEWPORT.height,
        };
        this.emit("frame", this.lastFrame);
        void this.cdp
          ?.send("Page.screencastFrameAck", { sessionId: evt.sessionId })
          .catch(() => {});
      });
      await this.cdp.send("Page.startScreencast", {
        format: "jpeg",
        quality: 60,
        maxWidth: VIEWPORT.width,
        maxHeight: VIEWPORT.height,
        everyNthFrame: 1,
      });
    } catch {
      // Live view is optional; the agent still works without it.
    }
  }

  private reset() {
    this.page = null;
    this.browser = null;
    this.cdp = null;
    this.lastFrame = null;
    this.emit("state", { open: false });
  }

  async close(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const b = this.browser;
    this.reset();
    await b?.close().catch(() => {});
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async navigate(raw: string) {
    const url = validateBrowserUrl(raw);
    const page = await this.ensure();
    const res = await page.goto(url.href, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await page
      .waitForNetworkIdle({ idleTime: 500, timeout: 8_000 })
      .catch(() => {});
    return res?.status();
  }

  async back() {
    const page = await this.ensure();
    await page
      .goBack({ waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => {});
  }

  async reload() {
    const page = await this.ensure();
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 });
  }

  private selectorFor(target: string): string {
    return /^e\d+$/.test(target) ? `[data-vynor-ref="${target}"]` : target;
  }

  async click(target: string) {
    const page = await this.ensure();
    const sel = this.selectorFor(target);
    await page.waitForSelector(sel, { timeout: 5_000, visible: true });
    await page.click(sel);
    await page
      .waitForNetworkIdle({ idleTime: 400, timeout: 5_000 })
      .catch(() => {});
  }

  async clickAt(x: number, y: number) {
    const page = await this.ensure();
    await page.mouse.click(x, y);
  }

  async type(target: string, text: string, submit = false) {
    const page = await this.ensure();
    const sel = this.selectorFor(target);
    await page.waitForSelector(sel, { timeout: 5_000, visible: true });
    await page.click(sel, { count: 3 });
    await page.keyboard.press("Backspace");
    await page.type(sel, text);
    if (submit) {
      await page.keyboard.press("Enter");
      await page
        .waitForNetworkIdle({ idleTime: 400, timeout: 8_000 })
        .catch(() => {});
    }
  }

  async typeText(text: string) {
    const page = await this.ensure();
    await page.keyboard.type(text);
  }

  async press(key: string) {
    const page = await this.ensure();
    await page.keyboard.press(key as any);
  }

  async scroll(dy: number) {
    const page = await this.ensure();
    await page.mouse.wheel({ deltaY: dy });
    await new Promise((r) => setTimeout(r, 300));
  }

  async waitFor(opts: { text?: string; ms?: number }) {
    const page = await this.ensure();
    if (opts.text) {
      await page.waitForFunction(
        `document.body && document.body.innerText.includes(${JSON.stringify(opts.text)})`,
        { timeout: Math.min(opts.ms ?? 10_000, 30_000) },
      );
    } else {
      await new Promise((r) =>
        setTimeout(r, Math.min(opts.ms ?? 1_000, 30_000)),
      );
    }
  }

  async evaluate(expression: string): Promise<string> {
    const page = await this.ensure();
    const value = await page.evaluate(
      `Promise.resolve((function () { return (${expression}
); })()).then(function (v) {
        try { return typeof v === "string" ? v : JSON.stringify(v, null, 2); }
        catch (e) { return String(v); }
      })`,
    );
    return String(value ?? "undefined").slice(0, 8_000);
  }

  async screenshot(): Promise<string> {
    const page = await this.ensure();
    const dir = path.join(getContinueUtilsPath(), "browser");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `shot-${Date.now()}.png`);
    await page.screenshot({ path: file });
    return file;
  }

  /** Text view of the page with refs for interactive elements. */
  async snapshot(maxText = 3_000): Promise<string> {
    const page = await this.ensure();
    await page.evaluate(PAGE_HELPERS);
    const data = await page.evaluate((limit: number) => {
      const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        const s = getComputedStyle(el);
        return (
          r.width > 0 &&
          r.height > 0 &&
          s.visibility !== "hidden" &&
          s.display !== "none"
        );
      };
      const label = (el: Element): string => {
        const h = el as HTMLInputElement;
        const aria = el.getAttribute("aria-label") || el.getAttribute("title");
        const byLabel = h.labels?.[0]?.innerText;
        const text = (el as HTMLElement).innerText;
        const ph = el.getAttribute("placeholder");
        return (
          aria ||
          byLabel ||
          text ||
          ph ||
          el.getAttribute("name") ||
          el.id ||
          ""
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
      };
      document
        .querySelectorAll("[data-vynor-ref]")
        .forEach((e) => e.removeAttribute("data-vynor-ref"));
      const items: string[] = [];
      let n = 0;
      const sel =
        'a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[onclick],[contenteditable="true"]';
      for (const el of Array.from(document.querySelectorAll(sel))) {
        if (!visible(el) || n >= 120) continue;
        const ref = `e${++n}`;
        el.setAttribute("data-vynor-ref", ref);
        const tag = el.tagName.toLowerCase();
        const inp = el as HTMLInputElement;
        const type =
          tag === "input" ? inp.type || "text" : el.getAttribute("role") || tag;
        let state = "";
        if (tag === "input" && ["checkbox", "radio"].includes(inp.type))
          state = inp.checked ? " [checked]" : " [unchecked]";
        else if (
          (tag === "input" || tag === "textarea") &&
          inp.type !== "password" &&
          inp.value
        )
          state = ` value="${inp.value.slice(0, 40)}"`;
        else if (inp.type === "password" && inp.value) state = " [filled]";
        if ((el as HTMLButtonElement).disabled) state += " [disabled]";
        const href =
          tag === "a"
            ? ` → ${(el as HTMLAnchorElement).getAttribute("href")?.slice(0, 60)}`
            : "";
        items.push(`${ref} ${type} "${label(el)}"${state}${href}`);
      }
      const frames = Array.from(document.querySelectorAll("iframe")).map(
        (f) => `iframe ${f.src.slice(0, 80) || "(inline)"}`,
      );
      const text = (document.body?.innerText ?? "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      return {
        title: document.title,
        url: location.href,
        scroll: `${Math.round(scrollY)}/${Math.max(0, document.documentElement.scrollHeight - innerHeight)}`,
        items,
        frames,
        text: text.slice(0, limit),
        truncated: text.length > limit,
      };
    }, maxText);
    const errors = this.logs.filter((l) => l.level === "error").length;
    return [
      `Page: ${data.title || "(untitled)"}`,
      `URL: ${data.url}`,
      `Scroll: ${data.scroll}px · console/network errors so far: ${errors}`,
      "",
      "Interactive elements (use the ref to click or type):",
      ...(data.items.length ? data.items : ["(none visible)"]),
      ...(data.frames.length ? ["", "Frames:", ...data.frames] : []),
      "",
      "Visible text:",
      data.text + (data.truncated ? "\n…(truncated)" : ""),
    ].join("\n");
  }
}

/** Shared by the agent tool and the IDE's live Browser panel. */
export const browserSession = new BrowserSession();
