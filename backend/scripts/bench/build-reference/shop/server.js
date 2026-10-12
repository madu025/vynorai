// Reference solution for the "shop" build task. It exists to prove that the
// acceptance checks in build.ts can all pass; the agent never sees it.
const http = require("node:http");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(path.join(__dirname, "data.db"));
db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT UNIQUE, name TEXT, role TEXT, salt TEXT, hash TEXT);
  CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER);
  CREATE TABLE IF NOT EXISTS products (id INTEGER PRIMARY KEY, name TEXT, description TEXT, price INTEGER, stock INTEGER, category TEXT);
  CREATE TABLE IF NOT EXISTS cart_items (user_id INTEGER, product_id INTEGER, quantity INTEGER, PRIMARY KEY (user_id, product_id));
  CREATE TABLE IF NOT EXISTS orders (id INTEGER PRIMARY KEY, user_id INTEGER, total INTEGER, status TEXT, created_at TEXT);
  CREATE TABLE IF NOT EXISTS order_items (order_id INTEGER, product_id INTEGER, name TEXT, price INTEGER, quantity INTEGER);
`);

const hashOf = (password, salt) =>
  crypto.scryptSync(password, salt, 32).toString("hex");
function createUser(email, password, name, role) {
  const salt = crypto.randomBytes(8).toString("hex");
  const r = db
    .prepare(
      "INSERT INTO users (email, name, role, salt, hash) VALUES (?, ?, ?, ?, ?)",
    )
    .run(email, name, role, salt, hashOf(password, salt));
  return { id: Number(r.lastInsertRowid), email, name, role };
}
if (!db.prepare("SELECT 1 FROM users WHERE email = ?").get("admin@shop.test")) {
  createUser("admin@shop.test", "admin123", "Admin", "admin");
}
if (db.prepare("SELECT COUNT(*) AS n FROM products").get().n === 0) {
  const add = db.prepare(
    "INSERT INTO products (name, description, price, stock, category) VALUES (?, ?, ?, ?, ?)",
  );
  for (const [n, p, c] of [
    ["Tea", 450, "food"],
    ["Rice", 900, "food"],
    ["Mug", 1200, "home"],
    ["Lamp", 3500, "home"],
    ["Pen", 150, "office"],
  ]) {
    add.run(n, `${n} description`, p, 20, c);
  }
}

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
});
function issue(user) {
  const token = crypto.randomBytes(24).toString("hex");
  db.prepare("INSERT INTO sessions (token, user_id) VALUES (?, ?)").run(
    token,
    user.id,
  );
  return { token, user: publicUser(user) };
}
function userOf(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  return (
    db
      .prepare(
        "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?",
      )
      .get(m[1]) || null
  );
}
function cartOf(userId) {
  const items = db
    .prepare(
      "SELECT c.product_id AS productId, p.name, p.price, c.quantity FROM cart_items c JOIN products p ON p.id = c.product_id WHERE c.user_id = ? ORDER BY c.product_id",
    )
    .all(userId)
    .map((i) => ({ ...i, lineTotal: i.price * i.quantity }));
  return { items, total: items.reduce((s, i) => s + i.lineTotal, 0) };
}
function orderOf(row) {
  const items = db
    .prepare(
      "SELECT product_id AS productId, name, price, quantity FROM order_items WHERE order_id = ?",
    )
    .all(row.id)
    .map((i) => ({ ...i, lineTotal: i.price * i.quantity }));
  return {
    id: row.id,
    items,
    total: row.total,
    status: row.status,
    createdAt: row.created_at,
  };
}
function validProduct(b) {
  return (
    b &&
    typeof b.name === "string" &&
    b.name.trim() &&
    Number.isInteger(b.price) &&
    b.price >= 0 &&
    Number.isInteger(b.stock) &&
    b.stock >= 0 &&
    typeof b.category === "string" &&
    b.category.trim()
  );
}

async function handle(req, res) {
  const url = new URL(req.url, "http://x");
  const send = (status, body) => {
    res.writeHead(
      status,
      body === undefined ? {} : { "Content-Type": "application/json" },
    );
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  let body = {};
  if (["POST", "PUT", "PATCH"].includes(req.method)) {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      return send(400, { error: "invalid JSON" });
    }
  }
  const p = url.pathname;
  const route = `${req.method} ${p}`;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    res.writeHead(200, { "Content-Type": "text/html" });
    return res.end(
      fs.readFileSync(path.join(__dirname, "public", "index.html")),
    );
  }
  if (route === "POST /api/auth/register") {
    const { email, password, name } = body;
    if (
      typeof email !== "string" ||
      !/^\S+@\S+\.\S+$/.test(email) ||
      typeof password !== "string" ||
      password.length < 6 ||
      typeof name !== "string" ||
      !name.trim()
    ) {
      return send(400, { error: "email, password (6+) and name are required" });
    }
    if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email))
      return send(409, { error: "email already registered" });
    return send(201, issue(createUser(email, password, name, "customer")));
  }
  if (route === "POST /api/auth/login") {
    const u = db
      .prepare("SELECT * FROM users WHERE email = ?")
      .get(String(body.email ?? ""));
    if (!u || hashOf(String(body.password ?? ""), u.salt) !== u.hash)
      return send(401, { error: "wrong email or password" });
    return send(200, issue(u));
  }
  if (route === "GET /api/products") {
    const q = (url.searchParams.get("q") || "").toLowerCase();
    const category = url.searchParams.get("category");
    const items = db
      .prepare("SELECT * FROM products ORDER BY id")
      .all()
      .filter(
        (x) =>
          (!q || x.name.toLowerCase().includes(q)) &&
          (!category || x.category === category),
      );
    return send(200, { items });
  }
  const productMatch = /^\/api\/products\/(\d+)$/.exec(p);
  if (productMatch && req.method === "GET") {
    const x = db
      .prepare("SELECT * FROM products WHERE id = ?")
      .get(Number(productMatch[1]));
    return x ? send(200, x) : send(404, { error: "not found" });
  }
  if (p === "/api/products" || productMatch) {
    const user = userOf(req);
    if (!user) return send(401, { error: "sign in" });
    if (user.role !== "admin") return send(403, { error: "admin only" });
    if (route === "POST /api/products") {
      if (!validProduct(body)) return send(400, { error: "invalid product" });
      const r = db
        .prepare(
          "INSERT INTO products (name, description, price, stock, category) VALUES (?, ?, ?, ?, ?)",
        )
        .run(
          body.name,
          body.description ?? "",
          body.price,
          body.stock,
          body.category,
        );
      return send(
        201,
        db
          .prepare("SELECT * FROM products WHERE id = ?")
          .get(Number(r.lastInsertRowid)),
      );
    }
    const id = Number(productMatch[1]);
    if (!db.prepare("SELECT 1 FROM products WHERE id = ?").get(id))
      return send(404, { error: "not found" });
    if (req.method === "PUT") {
      if (!validProduct(body)) return send(400, { error: "invalid product" });
      db.prepare(
        "UPDATE products SET name = ?, description = ?, price = ?, stock = ?, category = ? WHERE id = ?",
      ).run(
        body.name,
        body.description ?? "",
        body.price,
        body.stock,
        body.category,
        id,
      );
      return send(
        200,
        db.prepare("SELECT * FROM products WHERE id = ?").get(id),
      );
    }
    if (req.method === "DELETE") {
      db.prepare("DELETE FROM products WHERE id = ?").run(id);
      db.prepare("DELETE FROM cart_items WHERE product_id = ?").run(id);
      return send(204);
    }
  }
  if (p.startsWith("/api/cart") || p.startsWith("/api/orders")) {
    const user = userOf(req);
    if (!user) return send(401, { error: "sign in" });
    const line = /^\/api\/cart\/items\/(\d+)$/.exec(p);
    if (route === "GET /api/cart") return send(200, cartOf(user.id));
    if (route === "POST /api/cart/items") {
      const product = db
        .prepare("SELECT * FROM products WHERE id = ?")
        .get(Number(body.productId));
      if (!Number.isInteger(body.quantity) || body.quantity < 1)
        return send(400, { error: "quantity must be 1 or more" });
      if (!product) return send(404, { error: "unknown product" });
      const have =
        db
          .prepare(
            "SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ?",
          )
          .get(user.id, product.id)?.quantity ?? 0;
      if (have + body.quantity > product.stock)
        return send(409, { error: "not enough stock" });
      db.prepare(
        "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = quantity + excluded.quantity",
      ).run(user.id, product.id, body.quantity);
      return send(have ? 200 : 201, cartOf(user.id));
    }
    if (line && req.method === "PATCH") {
      const productId = Number(line[1]);
      if (!Number.isInteger(body.quantity) || body.quantity < 0)
        return send(400, { error: "invalid quantity" });
      if (body.quantity === 0) {
        db.prepare(
          "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
        ).run(user.id, productId);
      } else {
        const product = db
          .prepare("SELECT * FROM products WHERE id = ?")
          .get(productId);
        if (!product) return send(404, { error: "unknown product" });
        if (body.quantity > product.stock)
          return send(409, { error: "not enough stock" });
        db.prepare(
          "INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?) ON CONFLICT (user_id, product_id) DO UPDATE SET quantity = excluded.quantity",
        ).run(user.id, productId, body.quantity);
      }
      return send(200, cartOf(user.id));
    }
    if (line && req.method === "DELETE") {
      db.prepare(
        "DELETE FROM cart_items WHERE user_id = ? AND product_id = ?",
      ).run(user.id, Number(line[1]));
      return send(204);
    }
    if (route === "POST /api/orders") {
      const cart = cartOf(user.id);
      if (cart.items.length === 0) return send(400, { error: "cart is empty" });
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const i of cart.items) {
          const stock =
            db
              .prepare("SELECT stock FROM products WHERE id = ?")
              .get(i.productId)?.stock ?? 0;
          if (stock < i.quantity) {
            db.exec("ROLLBACK");
            return send(409, { error: `not enough stock for ${i.name}` });
          }
        }
        const createdAt = new Date().toISOString();
        const order = db
          .prepare(
            "INSERT INTO orders (user_id, total, status, created_at) VALUES (?, ?, 'paid', ?)",
          )
          .run(user.id, cart.total, createdAt);
        const orderId = Number(order.lastInsertRowid);
        for (const i of cart.items) {
          db.prepare("UPDATE products SET stock = stock - ? WHERE id = ?").run(
            i.quantity,
            i.productId,
          );
          db.prepare(
            "INSERT INTO order_items (order_id, product_id, name, price, quantity) VALUES (?, ?, ?, ?, ?)",
          ).run(orderId, i.productId, i.name, i.price, i.quantity);
        }
        db.prepare("DELETE FROM cart_items WHERE user_id = ?").run(user.id);
        db.exec("COMMIT");
        return send(
          201,
          orderOf(db.prepare("SELECT * FROM orders WHERE id = ?").get(orderId)),
        );
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    }
    if (route === "GET /api/orders") {
      const rows = db
        .prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC")
        .all(user.id);
      return send(200, { items: rows.map(orderOf) });
    }
    const one = /^\/api\/orders\/(\d+)$/.exec(p);
    if (one && req.method === "GET") {
      const row = db
        .prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?")
        .get(Number(one[1]), user.id);
      return row ? send(200, orderOf(row)) : send(404, { error: "not found" });
    }
  }
  return send(404, { error: "not found" });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: err.message }));
  });
});
if (require.main === module) {
  server.listen(Number(process.env.PORT) || 3000);
}
module.exports = { server };
