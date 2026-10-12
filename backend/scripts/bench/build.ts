/**
 * Build benchmark: the agent gets an empty folder and a product brief and must
 * deliver a complete, running system. Scored from outside, black box: install,
 * start, then HTTP checks against the contract in the brief, a restart to prove
 * persistence, and the project's own tests. No model-graded score.
 * See docs/AGENTIC_BUILD_PLAN.md.
 *
 *   npx tsx scripts/bench/build.ts --prepare shop --dir <dir>
 *   (run the agent on <dir>/project)
 *   npx tsx scripts/bench/build.ts --score <dir>
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

interface BuildTask {
  id: string;
  prompt: string;
}

const SHOP_BRIEF = `Build a complete small e-commerce web application in this empty folder. Deliver a finished, working system, not a plan or a skeleton: design the architecture, write every file, install what you need, run it and fix what fails until everything below works.

Stack: Node.js. You choose the libraries. All data lives in a SQLite database file and must survive a restart. "npm install" then "npm start" must start the server on the port in the PORT environment variable (default 3000). "npm test" must run automated tests that pass.

On first start create the schema and seed data: an admin user admin@shop.test with password admin123, and at least 5 products in at least 2 categories.

API (JSON; prices are integers in cents; authenticated routes take "Authorization: Bearer <token>"):
- POST /api/auth/register {email,password,name} -> 201 {token,user:{id,email,name,role}}. Role is "customer". Duplicate email -> 409. Missing or invalid fields -> 400.
- POST /api/auth/login {email,password} -> 200 {token,user}. Wrong credentials -> 401.
- GET /api/products -> 200 {items:[{id,name,description,price,stock,category}]}. Optional query: q (matches name, case-insensitive), category.
- GET /api/products/:id -> 200 product, unknown -> 404.
- POST /api/products (admin) {name,description,price,stock,category} -> 201 product. No token -> 401, not admin -> 403, invalid body such as a negative price -> 400.
- PUT /api/products/:id (admin) -> 200 updated product. DELETE /api/products/:id (admin) -> 204.
- GET /api/cart -> 200 {items:[{productId,name,price,quantity,lineTotal}],total}.
- POST /api/cart/items {productId,quantity} -> 200 or 201 with the cart. Adding a product already in the cart increases its quantity. Unknown product -> 404. More than the stock -> 409.
- PATCH /api/cart/items/:productId {quantity} -> 200 cart; quantity 0 removes the line.
- DELETE /api/cart/items/:productId -> 204.
- POST /api/orders -> 201 {id,items:[{productId,name,price,quantity,lineTotal}],total,status:"paid",createdAt}. Checkout of the caller's cart: stock goes down, the cart is emptied. Empty cart -> 400. Not enough stock -> 409 and nothing changes.
- GET /api/orders -> 200 {items:[orders of the caller only, newest first]}. GET /api/orders/:id -> the caller's order, anyone else's or unknown -> 404.
- Every cart and order route without a valid token -> 401.

Frontend: GET / serves a web page that lists the products, lets a visitor register or log in, add products to the cart, see the cart with its total and check out, by calling the API above.

Also write a README.md that says how to run it and lists the API.`;

export const BUILD_TASKS: BuildTask[] = [{ id: "shop", prompt: SHOP_BRIEF }];

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

function prepare(id: string, at: string) {
  const task = BUILD_TASKS.find((t) => t.id === id);
  if (!task) throw new Error(`no task ${id}`);
  fs.rmSync(at, { recursive: true, force: true });
  const dir = path.join(at, "project");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(at, "task.json"),
    JSON.stringify({
      id,
      dir,
      // The chat input submits on Enter, so the brief is sent as one line.
      prompt: task.prompt.replace(/\s*\n+\s*/g, " "),
    }),
  );
  console.log(dir);
}

// ─── Black-box acceptance ────────────────────────────────────────────────────

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as net.AddressInfo;
      s.close(() => resolve(port));
    });
  });

function killTree(child: ChildProcess | undefined) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
  } else {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
}

async function start(dir: string, port: number) {
  const out: string[] = [];
  const child = spawn("npm start", {
    cwd: dir,
    shell: true,
    detached: process.platform !== "win32",
    env: { ...process.env, PORT: String(port), NODE_ENV: "production" },
  });
  child.stdout?.on("data", (d) => out.push(String(d)));
  child.stderr?.on("data", (d) => out.push(String(d)));
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/products`, {
        signal: AbortSignal.timeout(2000),
      });
      if (res.status < 500) return { child, up: true, log: out };
    } catch {}
    await new Promise((r) => setTimeout(r, 700));
  }
  return { child, up: false, log: out };
}

interface Check {
  name: string;
  ok: boolean;
  detail?: string;
}

async function acceptance(dir: string) {
  const checks: Check[] = [];
  const add = (name: string, ok: boolean, detail = "") =>
    checks.push({ name, ok, detail: ok ? "" : detail.slice(0, 160) });
  const facts: Record<string, unknown> = {};

  const files = listSource(dir);
  facts.sourceFiles = files.length;
  facts.sourceLines = files.reduce(
    (n, f) => n + fs.readFileSync(path.join(dir, f), "utf8").split("\n").length,
    0,
  );
  facts.hasReadme = fs.existsSync(path.join(dir, "README.md"));
  add("package.json exists", fs.existsSync(path.join(dir, "package.json")));
  if (!fs.existsSync(path.join(dir, "package.json"))) {
    return { checks, facts };
  }

  const install = spawnSync("npm install --no-audit --no-fund", {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    timeout: 8 * 60_000,
  });
  add("npm install succeeds", install.status === 0, install.stderr ?? "");
  if (install.status !== 0) return { checks, facts };

  const port = await freePort();
  let srv = await start(dir, port);
  add("npm start serves on PORT", srv.up, srv.log.join("").slice(-300));
  if (!srv.up) {
    killTree(srv.child);
    return { checks, facts };
  }

  const base = `http://127.0.0.1:${port}`;
  const call = async (
    method: string,
    url: string,
    body?: unknown,
    token?: string,
  ) => {
    const res = await fetch(base + url, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await res.text();
    let json: any = undefined;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: res.status, json, text };
  };
  const step = async (name: string, fn: () => Promise<string | true>) => {
    try {
      const r = await fn();
      add(name, r === true, r === true ? "" : r);
    } catch (e: any) {
      add(name, false, `threw: ${e.message}`);
    }
  };
  const want = (cond: unknown, msg: string): string | true =>
    cond ? true : msg;

  const tag = Date.now().toString(36);
  const alice = {
    email: `alice-${tag}@test.dev`,
    password: "pass-1234",
    name: "Alice",
  };
  const bob = {
    email: `bob-${tag}@test.dev`,
    password: "pass-5678",
    name: "Bob",
  };
  let aliceToken = "";
  let bobToken = "";
  let adminToken = "";
  let productId: any;
  let orderId: any;

  await step("GET / serves an HTML page", async () => {
    const r = await call("GET", "/");
    return want(
      r.status === 200 && /<html|<!doctype/i.test(r.text),
      `status ${r.status}`,
    );
  });
  await step("seed: at least 5 products in 2 categories", async () => {
    const r = await call("GET", "/api/products");
    const items = r.json?.items ?? [];
    const cats = new Set(items.map((p: any) => p.category));
    return want(
      r.status === 200 && items.length >= 5 && cats.size >= 2,
      `status ${r.status}, ${items.length} items, ${cats.size} categories`,
    );
  });
  await step(
    "product has id, name, integer price, stock, category",
    async () => {
      const p = (await call("GET", "/api/products")).json?.items?.[0] ?? {};
      return want(
        p.id !== undefined &&
          typeof p.name === "string" &&
          Number.isInteger(p.price) &&
          Number.isInteger(p.stock) &&
          typeof p.category === "string",
        JSON.stringify(p),
      );
    },
  );
  await step("register -> 201 with token and customer role", async () => {
    const r = await call("POST", "/api/auth/register", alice);
    aliceToken = r.json?.token ?? "";
    return want(
      r.status === 201 &&
        aliceToken &&
        r.json?.user?.role === "customer" &&
        r.json?.user?.email === alice.email,
      `status ${r.status} ${r.text.slice(0, 80)}`,
    );
  });
  await step("register duplicate email -> 409", async () => {
    const r = await call("POST", "/api/auth/register", alice);
    return want(r.status === 409, `status ${r.status}`);
  });
  await step("register invalid body -> 400", async () => {
    const r = await call("POST", "/api/auth/register", { email: "x" });
    return want(r.status === 400, `status ${r.status}`);
  });
  await step("user response never contains the password", async () => {
    const r = await call("POST", "/api/auth/login", alice);
    return want(
      r.status === 200 &&
        !/pass-1234/.test(r.text) &&
        r.json?.user?.password === undefined,
      `status ${r.status}`,
    );
  });
  await step("login wrong password -> 401", async () => {
    const r = await call("POST", "/api/auth/login", {
      ...alice,
      password: "nope",
    });
    return want(r.status === 401, `status ${r.status}`);
  });
  await step("seeded admin can log in", async () => {
    const r = await call("POST", "/api/auth/login", {
      email: "admin@shop.test",
      password: "admin123",
    });
    adminToken = r.json?.token ?? "";
    return want(
      r.status === 200 && adminToken && r.json?.user?.role === "admin",
      `status ${r.status}`,
    );
  });
  await step("create product: no token -> 401", async () => {
    const r = await call("POST", "/api/products", {
      name: "X",
      description: "d",
      price: 100,
      stock: 1,
      category: "c",
    });
    return want(r.status === 401, `status ${r.status}`);
  });
  await step("create product: customer -> 403", async () => {
    const r = await call(
      "POST",
      "/api/products",
      { name: "X", description: "d", price: 100, stock: 1, category: "c" },
      aliceToken,
    );
    return want(r.status === 403, `status ${r.status}`);
  });
  await step("create product: negative price -> 400", async () => {
    const r = await call(
      "POST",
      "/api/products",
      { name: "X", description: "d", price: -5, stock: 1, category: "c" },
      adminToken,
    );
    return want(r.status === 400, `status ${r.status}`);
  });
  await step("create product as admin -> 201", async () => {
    const r = await call(
      "POST",
      "/api/products",
      {
        name: `Zebra Lamp ${tag}`,
        description: "striped",
        price: 2500,
        stock: 3,
        category: `cat-${tag}`,
      },
      adminToken,
    );
    productId = r.json?.id;
    return want(
      r.status === 201 && productId !== undefined && r.json?.price === 2500,
      `status ${r.status} ${r.text.slice(0, 80)}`,
    );
  });
  await step("GET product by id, unknown -> 404", async () => {
    const ok = await call("GET", `/api/products/${productId}`);
    const no = await call("GET", "/api/products/99999999");
    return want(
      ok.status === 200 &&
        ok.json?.name === `Zebra Lamp ${tag}` &&
        no.status === 404,
      `${ok.status} / ${no.status}`,
    );
  });
  await step("search q is case-insensitive", async () => {
    const r = await call("GET", `/api/products?q=zebra%20lamp%20${tag}`);
    return want(
      r.status === 200 && r.json?.items?.length === 1,
      `${r.json?.items?.length} items`,
    );
  });
  await step("filter by category", async () => {
    const r = await call("GET", `/api/products?category=cat-${tag}`);
    return want(
      r.status === 200 &&
        r.json?.items?.length === 1 &&
        r.json.items[0].id === productId,
      `${r.json?.items?.length} items`,
    );
  });
  await step("update product as admin", async () => {
    const r = await call(
      "PUT",
      `/api/products/${productId}`,
      {
        name: `Zebra Lamp ${tag}`,
        description: "striped",
        price: 2000,
        stock: 3,
        category: `cat-${tag}`,
      },
      adminToken,
    );
    return want(
      r.status === 200 && r.json?.price === 2000,
      `status ${r.status}`,
    );
  });
  await step("cart without token -> 401", async () => {
    const r = await call("GET", "/api/cart");
    return want(r.status === 401, `status ${r.status}`);
  });
  await step("new user has an empty cart", async () => {
    const r = await call("GET", "/api/cart", undefined, aliceToken);
    return want(
      r.status === 200 &&
        Array.isArray(r.json?.items) &&
        r.json.items.length === 0 &&
        r.json.total === 0,
      r.text.slice(0, 80),
    );
  });
  await step("add to cart, line total and total", async () => {
    const r = await call(
      "POST",
      "/api/cart/items",
      { productId, quantity: 1 },
      aliceToken,
    );
    const cart = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    const line = cart?.items?.[0] ?? {};
    return want(
      (r.status === 200 || r.status === 201) &&
        line.quantity === 1 &&
        line.lineTotal === 2000 &&
        cart.total === 2000,
      `status ${r.status} ${JSON.stringify(cart).slice(0, 100)}`,
    );
  });
  await step("adding the same product increases quantity", async () => {
    await call(
      "POST",
      "/api/cart/items",
      { productId, quantity: 1 },
      aliceToken,
    );
    const cart = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    return want(
      cart?.items?.length === 1 &&
        cart.items[0].quantity === 2 &&
        cart.total === 4000,
      JSON.stringify(cart).slice(0, 100),
    );
  });
  await step("more than stock -> 409, unknown product -> 404", async () => {
    const over = await call(
      "POST",
      "/api/cart/items",
      { productId, quantity: 50 },
      aliceToken,
    );
    const none = await call(
      "POST",
      "/api/cart/items",
      { productId: 99999999, quantity: 1 },
      aliceToken,
    );
    return want(
      over.status === 409 && none.status === 404,
      `${over.status} / ${none.status}`,
    );
  });
  await step("PATCH quantity, 0 removes the line", async () => {
    const a = await call(
      "PATCH",
      `/api/cart/items/${productId}`,
      { quantity: 3 },
      aliceToken,
    );
    const mid = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    await call(
      "PATCH",
      `/api/cart/items/${productId}`,
      { quantity: 0 },
      aliceToken,
    );
    const end = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    return want(
      a.status === 200 &&
        mid?.items?.[0]?.quantity === 3 &&
        end?.items?.length === 0,
      `${a.status} ${JSON.stringify(mid).slice(0, 60)}`,
    );
  });
  await step("checkout of an empty cart -> 400", async () => {
    const r = await call("POST", "/api/orders", {}, aliceToken);
    return want(r.status === 400, `status ${r.status}`);
  });
  await step("DELETE cart line -> 204", async () => {
    await call(
      "POST",
      "/api/cart/items",
      { productId, quantity: 1 },
      aliceToken,
    );
    const r = await call(
      "DELETE",
      `/api/cart/items/${productId}`,
      undefined,
      aliceToken,
    );
    const cart = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    return want(
      r.status === 204 && cart?.items?.length === 0,
      `status ${r.status}`,
    );
  });
  await step("checkout -> 201 paid order with items and total", async () => {
    await call(
      "POST",
      "/api/cart/items",
      { productId, quantity: 2 },
      aliceToken,
    );
    const r = await call("POST", "/api/orders", {}, aliceToken);
    orderId = r.json?.id;
    return want(
      r.status === 201 &&
        orderId !== undefined &&
        r.json?.status === "paid" &&
        r.json?.total === 4000 &&
        r.json?.items?.[0]?.quantity === 2 &&
        r.json?.createdAt,
      `status ${r.status} ${r.text.slice(0, 100)}`,
    );
  });
  await step("checkout reduces stock and empties the cart", async () => {
    const p = (await call("GET", `/api/products/${productId}`)).json;
    const cart = (await call("GET", "/api/cart", undefined, aliceToken)).json;
    return want(
      p?.stock === 1 && cart?.items?.length === 0,
      `stock ${p?.stock}, cart ${cart?.items?.length}`,
    );
  });
  await step(
    "second buyer: stock taken between add and checkout -> 409, nothing changes",
    async () => {
      bobToken =
        (await call("POST", "/api/auth/register", bob)).json?.token ?? "";
      await call(
        "POST",
        "/api/cart/items",
        { productId, quantity: 1 },
        bobToken,
      );
      await call(
        "POST",
        "/api/cart/items",
        { productId, quantity: 1 },
        aliceToken,
      );
      const first = await call("POST", "/api/orders", {}, aliceToken);
      const second = await call("POST", "/api/orders", {}, bobToken);
      const p = (await call("GET", `/api/products/${productId}`)).json;
      const bobCart = (await call("GET", "/api/cart", undefined, bobToken))
        .json;
      return want(
        first.status === 201 &&
          second.status === 409 &&
          p?.stock === 0 &&
          bobCart?.items?.length === 1,
        `${first.status} / ${second.status}, stock ${p?.stock}, bob cart ${bobCart?.items?.length}`,
      );
    },
  );
  await step("orders list: own orders only, newest first", async () => {
    const mine =
      (await call("GET", "/api/orders", undefined, aliceToken)).json?.items ??
      [];
    const theirs =
      (await call("GET", "/api/orders", undefined, bobToken)).json?.items ?? [];
    const newestFirst =
      mine.length === 2 &&
      String(mine[0].createdAt) >= String(mine[1].createdAt);
    return want(
      newestFirst && theirs.length === 0,
      `mine ${mine.length}, theirs ${theirs.length}`,
    );
  });
  await step(
    "order by id: owner 200, another user 404, no token 401",
    async () => {
      const own = await call(
        "GET",
        `/api/orders/${orderId}`,
        undefined,
        aliceToken,
      );
      const other = await call(
        "GET",
        `/api/orders/${orderId}`,
        undefined,
        bobToken,
      );
      const anon = await call("GET", `/api/orders/${orderId}`);
      return want(
        own.status === 200 && other.status === 404 && anon.status === 401,
        `${own.status} / ${other.status} / ${anon.status}`,
      );
    },
  );
  await step("delete product as admin -> 204, then 404", async () => {
    const made = await call(
      "POST",
      "/api/products",
      {
        name: `Temp ${tag}`,
        description: "d",
        price: 100,
        stock: 1,
        category: "tmp",
      },
      adminToken,
    );
    const del = await call(
      "DELETE",
      `/api/products/${made.json?.id}`,
      undefined,
      adminToken,
    );
    const gone = await call("GET", `/api/products/${made.json?.id}`);
    return want(
      del.status === 204 && gone.status === 404,
      `${del.status} / ${gone.status}`,
    );
  });
  await step("frontend page talks to the API", async () => {
    const page = (await call("GET", "/")).text;
    const scripts = [...page.matchAll(/<script[^>]+src="([^"]+)"/g)].map(
      (m) => m[1],
    );
    let code = page;
    for (const s of scripts.slice(0, 5)) {
      if (/^https?:/.test(s)) continue;
      code += (await call("GET", s.startsWith("/") ? s : `/${s}`)).text;
    }
    return want(
      /\/api\/products/.test(code) &&
        /\/api\/cart/.test(code) &&
        /\/api\/orders/.test(code),
      "page and its scripts do not call products, cart and orders",
    );
  });

  // Persistence: stop, start again, the data is still there.
  killTree(srv.child);
  await new Promise((r) => setTimeout(r, 1500));
  srv = await start(dir, port);
  await step("restart: server comes up again", async () =>
    want(srv.up, "did not start"),
  );
  if (srv.up) {
    await step("restart: user, order and stock survived", async () => {
      const login = await call("POST", "/api/auth/login", alice);
      const orders =
        (await call("GET", "/api/orders", undefined, login.json?.token)).json
          ?.items ?? [];
      const p = (await call("GET", `/api/products/${productId}`)).json;
      return want(
        login.status === 200 && orders.length === 2 && p?.stock === 0,
        `login ${login.status}, orders ${orders.length}, stock ${p?.stock}`,
      );
    });
  }
  killTree(srv.child);

  const tests = spawnSync("npm test", {
    cwd: dir,
    shell: true,
    encoding: "utf8",
    timeout: 5 * 60_000,
    env: { ...process.env, CI: "1" },
  });
  add(
    "npm test passes",
    tests.status === 0,
    `${tests.stdout ?? ""}${tests.stderr ?? ""}`.slice(-200),
  );
  add(
    "README.md lists the API",
    facts.hasReadme === true &&
      /\/api\/orders/.test(
        fs.readFileSync(path.join(dir, "README.md"), "utf8"),
      ),
  );
  return { checks, facts };
}

function listSource(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (["node_modules", ".git", "dist", "coverage"].includes(e.name))
        continue;
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(js|mjs|cjs|ts|tsx|jsx|html|css|sql)$/.test(e.name)) {
        out.push(path.relative(dir, full).split(path.sep).join("/"));
      }
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return out.sort();
}

async function main() {
  if (arg("prepare"))
    return prepare(arg("prepare")!, path.resolve(arg("dir")!));
  if (arg("score")) {
    const at = path.resolve(arg("score")!);
    const saved = JSON.parse(
      fs.readFileSync(path.join(at, "task.json"), "utf8"),
    );
    const { checks, facts } = await acceptance(saved.dir);
    const passed = checks.filter((c) => c.ok).length;
    const result = {
      id: saved.id,
      passed,
      total: checks.length,
      pass: passed === checks.length && checks.length > 30,
      facts,
      failed: checks
        .filter((c) => !c.ok)
        .map((c) => `${c.name}${c.detail ? ` [${c.detail}]` : ""}`),
    };
    fs.writeFileSync(
      path.join(at, "score.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
    process.exit(0);
  }
  console.error("usage: --prepare <id> --dir <dir> | --score <dir>");
  process.exit(2);
}
void main();
