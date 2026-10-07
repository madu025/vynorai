/**
 * VynorAI Memory & Rules API
 * ---------------------------
 * User-facing endpoints for managing persistent rules and memory.
 * Authenticated with the user's VynorAI API key (same as /v1/chat).
 */

import { Router, Request, Response } from "express";
import { z } from "zod";
import { authenticateApiKey } from "../services/aiProxy.js";
import {
  getUserRules,
  addUserRule,
  deleteUserRule,
  clearUserRules,
  getUserMemory,
  setMemory,
  deleteMemory,
  clearMemory,
} from "../services/memoryEngine.js";
import {
  validateBody,
  validateParams,
  validateQuery,
} from "../middleware/validate.js";

export const memoryRouter = Router();

async function auth(req: Request, res: Response): Promise<any | null> {
  const user = await authenticateApiKey(req.headers.authorization);
  if (!user) {
    res.status(401).json({ error: "Invalid API key" });
    return null;
  }
  return user;
}

// ─── Zod Schemas ─────────────────────────────────────────────────────────────
export const AddRuleSchema = z.object({
  rule: z
    .string({ error: "rule is required" })
    .trim()
    .min(1, "rule is required"),
  scope: z.string().optional().default("global"),
});

export const RuleParamSchema = z.object({
  id: z.string().min(1, "id is required"),
});

export const RulesQuerySchema = z.object({
  scope: z.string().optional().default("global"),
});

export const PutMemorySchema = z.object({
  value: z.string({ error: "value is required" }).min(1, "value is required"),
  ttl_days: z.coerce.number().positive().optional(),
});

export const MemoryParamSchema = z.object({
  key: z.string().min(1, "key is required"),
});

// ─── Rules ────────────────────────────────────────────────────────────────────

/** GET /v1/memory/rules — list all rules */
memoryRouter.get(
  "/rules",
  validateQuery(RulesQuerySchema),
  async (req, res) => {
    const user = await auth(req, res);
    if (!user) return;
    const scope = (req as any).validatedQuery?.scope || "global";
    const rules = await getUserRules(user.id, scope);
    res.json({ scope, rules, count: rules.length });
  },
);

/** POST /v1/memory/rules — add a rule */
memoryRouter.post("/rules", validateBody(AddRuleSchema), async (req, res) => {
  const user = await auth(req, res);
  if (!user) return;
  const { rule, scope } = req.body;
  const id = await addUserRule(user.id, rule, scope);
  res.json({ ok: true, id, rule, scope });
});

/** DELETE /v1/memory/rules/:id — delete one rule */
memoryRouter.delete(
  "/rules/:id",
  validateParams(RuleParamSchema),
  async (req, res) => {
    const user = await auth(req, res);
    if (!user) return;
    await deleteUserRule(user.id, req.params["id"] as string);
    res.json({ ok: true });
  },
);

/** DELETE /v1/memory/rules — clear all rules */
memoryRouter.delete(
  "/rules",
  validateQuery(RulesQuerySchema),
  async (req, res) => {
    const user = await auth(req, res);
    if (!user) return;
    const scope = (req as any).validatedQuery?.scope || "global";
    await clearUserRules(user.id, scope);
    res.json({ ok: true, message: `All ${scope} rules cleared` });
  },
);

// ─── Memory ───────────────────────────────────────────────────────────────────

/** GET /v1/memory — get all memory entries */
memoryRouter.get("/", async (req, res) => {
  const user = await auth(req, res);
  if (!user) return;
  const memory = await getUserMemory(user.id);
  res.json({ memory, count: Object.keys(memory).length });
});

/** PUT /v1/memory/:key — set a memory value */
memoryRouter.put(
  "/:key",
  validateParams(MemoryParamSchema),
  validateBody(PutMemorySchema),
  async (req, res) => {
    const user = await auth(req, res);
    if (!user) return;
    const { value, ttl_days } = req.body;
    const key = req.params["key"] as string;
    await setMemory(user.id, key, value, ttl_days);
    res.json({ ok: true, key, value });
  },
);

/** DELETE /v1/memory/:key — forget a specific key */
memoryRouter.delete(
  "/:key",
  validateParams(MemoryParamSchema),
  async (req, res) => {
    const user = await auth(req, res);
    if (!user) return;
    await deleteMemory(user.id, req.params["key"] as string);
    res.json({ ok: true });
  },
);

/** DELETE /v1/memory — clear all memory */
memoryRouter.delete("/", async (req, res) => {
  const user = await auth(req, res);
  if (!user) return;
  await clearMemory(user.id);
  res.json({ ok: true, message: "All memory cleared" });
});
