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

interface FakeScript {
  src: string;
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
  assert.deepEqual(order, [
    "build-id.js",
    "runtime-config.js",
    "taskpane.bundle.js",
  ]);
  assert.ok(page.added.every((script) => script.async === true));
  assert.match(page.added[2].src, /taskpane\.bundle\.js\?v=abc123$/);
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

test("a build id that never loads still gives a unique bundle URL", () => {
  const page = run((src, window) =>
    src.includes("build-id.js") ? "error" : healthy(src, window),
  );
  page.tick(60_000);
  assert.equal(
    page.added.filter((s) => s.src.includes("build-id.js")).length,
    3,
  );
  const bundle = page.added.find((s) => s.src.includes("taskpane.bundle.js"));
  assert.match(bundle!.src, /\?v=open-[a-z0-9]+$/);
});
