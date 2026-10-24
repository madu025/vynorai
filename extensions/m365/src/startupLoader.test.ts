import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const html = readFileSync(new URL("../taskpane.html", import.meta.url), "utf8");
const marker = "var openingId";
const start = html.lastIndexOf("<script>", html.indexOf(marker));
const loader = html.slice(
  start + "<script>".length,
  html.indexOf("</script>", start),
);

const inlineBuildId = /var BUILD = "([^"]+)"/.exec(loader)?.[1] ?? "";

interface FakeScript {
  src: string;
  type?: string;
  async?: boolean;
  onload?: () => void;
  onerror?: () => void;
}

/** Runs the start-up loader against a fake page; `answer` decides what each requested file does. */
function run(answer: (src: string, window: any) => "ok" | "error" | "stall") {
  const timers: { at: number; fn: () => void }[] = [];
  let now = 0;
  const added: FakeScript[] = [];
  const status = { textContent: "Loading…" };
  const window: any = {
    setTimeout: (fn: () => void, ms: number) => {
      timers.push({ at: now + ms, fn });
      return timers.length;
    },
  };
  const document = {
    getElementById: (id: string) => (id === "status-text" ? status : null),
    createElement: (tag: string) => ({ tag, src: "" }) as any,
    head: { appendChild() {} },
    body: {
      appendChild(node: any) {
        if (node.tag !== "script") return;
        added.push(node);
        const result = answer(node.src, window);
        if (result === "stall") return;
        timers.push({
          at: now + 50,
          fn: () => (result === "ok" ? node.onload?.() : node.onerror?.()),
        });
      },
    },
  };
  vm.runInNewContext(loader, { window, document, Date });
  const tick = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > end) break;
      timers.shift();
      now = next.at;
      next.fn();
    }
    now = end;
  };
  return { added, tick, window, status };
}

const fileOf = (src: string) => src.split("?")[0].split("/").pop();
const healthy = (src: string, window: any) => {
  if (src.includes("build-id.js")) window.__VYNOR_M365_BUILD_ID__ = "abc123";
  if (src.includes("runtime-config.js"))
    window.__VYNORAI_M365_CONFIG__ = { apiBaseUrl: "x" };
  return "ok" as const;
};

test("the bundle is requested only after the config exists", () => {
  const order: string[] = [];
  const page = run((src, window) => {
    order.push(fileOf(src)!);
    return healthy(src, window);
  });
  page.tick(1000);
  assert.deepEqual(order, ["runtime-config.js", "taskpane.bundle.js"]);
  assert.ok(page.added.every((script) => script.async === true));
  // The build id is written in the page, so no request is needed to learn it.
  assert.equal(inlineBuildId.length > 0, true);
  assert.equal(
    page.added[1].src,
    `./dist/taskpane.bundle.js?v=${encodeURIComponent(inlineBuildId)}`,
  );
  // The bundle is an ES module (it has split chunks); the config is a classic script.
  assert.equal(page.added[1].type, "module");
  assert.equal(page.added[0].type, undefined);
});

test("a config that fails once is asked for again before the bundle starts", () => {
  let configTries = 0;
  const order: string[] = [];
  const page = run((src, window) => {
    order.push(src);
    if (src.includes("runtime-config.js") && configTries++ === 0)
      return "error";
    return healthy(src, window);
  });
  page.tick(5000);
  const config = order.filter((src) => src.includes("runtime-config.js"));
  assert.equal(config.length, 2);
  assert.match(config[1], /&try=1$/);
  assert.ok(
    order.findIndex((src) => src.includes("taskpane.bundle.js")) >
      order.lastIndexOf(config[1]),
  );
});

test("a stalled bundle is asked for again, and no more once the pane has started", () => {
  const page = run((src, window) =>
    src.includes("taskpane.bundle.js") ? "stall" : healthy(src, window),
  );
  page.tick(1000);
  assert.equal(page.added.filter((s) => s.src.includes("bundle")).length, 1);
  page.tick(12_000);
  const copies = page.added.filter((s) => s.src.includes("bundle"));
  assert.equal(copies.length, 2);
  assert.match(copies[1].src, /&try=1$/);
  page.window.__VYNOR_BOOTED__ = true;
  page.tick(60_000);
  assert.equal(page.added.filter((s) => s.src.includes("bundle")).length, 2);
});

test("pane.css exists and every versioned URL in the page carries the Build id", () => {
  const css = readFileSync(new URL("../pane.css", import.meta.url), "utf8");
  assert.ok(css.length > 50_000);
  assert.ok(
    !/<style/.test(html.replace(/<style id="critical">[\s\S]*?<\/style>/, "")),
  );
  const shown = /Build (\d{8}\.\d+)/.exec(html)?.[1];
  assert.ok(shown);
  assert.equal(inlineBuildId, shown);
  const versions = [
    ...html.matchAll(/[a-z.\-/]+\.(?:css|js)\?v=([\d.]+)/g),
  ].map((m) => m[1]);
  assert.ok(versions.length >= 3);
  assert.ok(
    versions.every((v) => v === shown),
    `ids ${versions.join(",")}`,
  );
});

test("a stalled config does not leave the page without a bundle", () => {
  const page = run((src, window) =>
    src.includes("runtime-config.js") ? "error" : healthy(src, window),
  );
  page.tick(60_000);
  assert.ok(page.added.some((s) => s.src.includes("taskpane.bundle.js")));
});
