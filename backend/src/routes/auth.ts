import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { dbGet, dbRun, dbAll } from "../db.js";
import { config } from "../config.js";

export const authRouter = Router();

// Middleware to authenticate JWT
export async function requireAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId: string; email: string };
    const user = await dbGet("SELECT id, email, name, api_key FROM users WHERE id = ?", [payload.userId]);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// Register
authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered. Please log in." });
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;

    await dbRun(
      "INSERT INTO users (id, email, password_hash, api_key, name) VALUES (?, ?, ?, ?, ?)",
      [userId, email.toLowerCase().trim(), passwordHash, apiKey, name || ""]
    );

    const token = jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: "30d" });

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        name,
        apiKey,
      },
    });
  } catch (err: any) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Login
authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await dbGet<any>("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, config.jwtSecret, { expiresIn: "30d" });

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        apiKey: user.api_key,
      },
    });
  } catch (err: any) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Get current user profile + active subscription
authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const now = new Date().toISOString();

    const subscription = await dbGet<any>(
      `SELECT * FROM subscriptions 
       WHERE user_id = ? AND status = 'active' AND valid_until > ? 
       ORDER BY valid_until DESC LIMIT 1`,
      [user.id, now]
    );

    const planId = subscription?.plan_name || "free";
    const monthlyUsage = await dbGet<any>(
      "SELECT * FROM monthly_usage WHERE user_id = ?",
      [user.id]
    );

    const totalUsage = await dbGet<any>(
      "SELECT COUNT(*) as requestCount, SUM(tokens_used) as totalTokens FROM usage_logs WHERE user_id = ?",
      [user.id]
    );

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        apiKey: user.api_key,
      },
      subscription: subscription || null,
      monthlyUsage: monthlyUsage || null,
      hasActiveSubscription: !!subscription,
      usage: {
        requestCount: totalUsage?.requestCount || 0,
        totalTokens: totalUsage?.totalTokens || 0,
      },
    });
  } catch (err: any) {

    console.error("Profile error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
