/**
 * VynorAI Memory & Rules API
 * ---------------------------
 * User-facing endpoints for managing persistent rules and memory.
 * Authenticated with the user's VynorAI API key (same as /v1/chat).
 */

import { Router, Request, Response } from "express";
import { authenticateApiKey } from "../services/aiProxy.js";
import {
  getUserRules, addUserRule, deleteUserRule, clearUserRules,
  getUserMemory, setMemory, deleteMemory, clearMemory,
} from "../services/memoryEngine.js";

export const memoryRouter = Router();

async function auth(req: Request, res: Response): Promise<any | null> {
  const user = await authenticateApiKey(req.headers.authorization);
  if (!user) { res.status(401).json({ error: "Invalid API key" }); return null; }
  return user;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

/** GET /v1/memory/rules — list all rules */
memoryRouter.get("/rules", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  const scope = String(req.query.scope || "global");
  const rules = await getUserRules(user.id, scope);
  res.json({ scope, rules, count: rules.length });
});

/** POST /v1/memory/rules — add a rule */
memoryRouter.post("/rules", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  const { rule, scope = "global" } = req.body;
  if (!rule?.trim()) return res.status(400).json({ error: "rule is required" });
  const id = await addUserRule(user.id, rule, scope);
  res.json({ ok: true, id, rule, scope });
});

/** DELETE /v1/memory/rules/:id — delete one rule */
memoryRouter.delete("/rules/:id", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  await deleteUserRule(user.id, req.params["id"] as string);
  res.json({ ok: true });
});

/** DELETE /v1/memory/rules — clear all rules */
memoryRouter.delete("/rules", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  const scope = String(req.query.scope || "global");
  await clearUserRules(user.id, scope);
  res.json({ ok: true, message: `All ${scope} rules cleared` });
});

// ─── Memory ───────────────────────────────────────────────────────────────────

/** GET /v1/memory — get all memory entries */
memoryRouter.get("/", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  const memory = await getUserMemory(user.id);
  res.json({ memory, count: Object.keys(memory).length });
});

/** PUT /v1/memory/:key — set a memory value */
memoryRouter.put("/:key", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  const { value, ttl_days } = req.body;
  if (!value) return res.status(400).json({ error: "value is required" });
  const key = req.params["key"] as string;
  await setMemory(user.id, key, value, ttl_days ? Number(ttl_days) : undefined);
  res.json({ ok: true, key, value });
});

/** DELETE /v1/memory/:key — forget a specific key */
memoryRouter.delete("/:key", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  await deleteMemory(user.id, req.params["key"] as string);
  res.json({ ok: true });
});

/** DELETE /v1/memory — clear all memory */
memoryRouter.delete("/", async (req, res) => {
  const user = await auth(req, res); if (!user) return;
  await clearMemory(user.id);
  res.json({ ok: true, message: "All memory cleared" });
});
