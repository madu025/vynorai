import crypto from "crypto";
import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "uuid";
import { dbGet, dbRun, dbAll } from "../db.js";
import { config } from "../config.js";

export const authRouter = Router();

import { logSecurityEvent, getUserSecurityEvents } from "../services/securityAudit.js";
import { sendVerificationEmail } from "../services/emailService.js";

// Middleware to authenticate JWT
export async function requireAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }

  const token = authHeader.replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, config.jwtSecret) as { userId: string; email: string };
    const user = await dbGet<any>(
      "SELECT id, email, name, api_key, COALESCE(is_suspended, 0) as is_suspended, allowed_ips, COALESCE(email_verified, 0) as email_verified FROM users WHERE id = ?",
      [payload.userId]
    );
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }
    if (user.is_suspended === 1) {
      return res.status(403).json({ error: "Your account has been suspended for security violations. Contact security@vynor.lk" });
    }
    (req as any).user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

import { authRateLimiter } from "../middleware/security.js";

// Helper to verify Cloudflare Turnstile token if configured
async function verifyTurnstileToken(token?: string, remoteIp?: string): Promise<boolean> {
  const secretKey = process.env.TURNSTILE_SECRET_KEY;
  // If not configured in environment, allow to pass smoothly (doesn't break existing dev/prod)
  if (!secretKey) return true;
  if (!token) return false;

  try {
    const formData = new URLSearchParams();
    formData.append("secret", secretKey);
    formData.append("response", token);
    if (remoteIp) formData.append("remoteip", remoteIp);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
    });
    const outcome = await res.json() as { success: boolean };
    return outcome.success === true;
  } catch (err) {
    console.error("[Turnstile] Verification failed with error:", err);
    return false;
  }
}

// Register
authRouter.post("/register", authRateLimiter, async (req: Request, res: Response) => {
  try {
    const { email, password, name, turnstileToken } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    // Verify Turnstile bot protection if token/secret present
    const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
    const isHuman = await verifyTurnstileToken(turnstileToken, clientIp);
    if (!isHuman) {
      return res.status(400).json({ error: "Security check failed. Please verify you are human." });
    }

    const existingUser = await dbGet("SELECT id FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered. Please log in." });
    }

    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const apiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;
    const apiKeyHash = crypto.createHash("sha256").update(apiKey).digest("hex");

    await dbRun(
      "INSERT INTO users (id, email, password_hash, api_key, api_key_hash, name, email_verified) VALUES (?, ?, ?, ?, ?, ?, 0)",
      [userId, email.toLowerCase().trim(), passwordHash, apiKey, apiKeyHash, name || ""]
    );

    // Generate 6-digit OTP and verification token with SHA-256 hashes
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyToken = uuidv4().replace(/-/g, "");
    const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
    const tokenHash = crypto.createHash("sha256").update(verifyToken).digest("hex");
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    await dbRun(
      "INSERT INTO email_verifications (id, user_id, email, otp_hash, token_hash, attempts, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [uuidv4(), userId, email.toLowerCase().trim(), otpHash, tokenHash, expiresAt]
    );

    // Send verification email in background
    sendVerificationEmail(email.toLowerCase().trim(), name || "", otpCode, verifyToken).catch(err => {
      console.error("[Email] Verification email send failure:", err);
    });

    await logSecurityEvent({
      eventType: "AUTH_REGISTER",
      severity: "INFO",
      actor: email.toLowerCase().trim(),
      target: userId,
      details: "New account registered. Verification OTP dispatched.",
      ipAddress: clientIp,
    });

    const token = jwt.sign({ userId, email }, config.jwtSecret, { expiresIn: "30d" });

    res.json({
      success: true,
      token,
      user: {
        id: userId,
        email,
        name,
        apiKey,
        emailVerified: false,
      },
    });
  } catch (err: any) {
    console.error("Registration error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Redirect GET /api/auth/login requests to UI login page preserving query params
authRouter.get("/login", (req: Request, res: Response) => {
  const query = req.url.includes("?") ? req.url.substring(req.url.indexOf("?")) : "";
  res.redirect(`/login${query}`);
});

// Login (with Rate Limiting against Brute-Force & Suspension check)
authRouter.post("/login", authRateLimiter, async (req: Request, res: Response) => {
  const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const user = await dbGet<any>("SELECT * FROM users WHERE email = ?", [email.toLowerCase().trim()]);
    if (!user) {
      await logSecurityEvent({
        eventType: "AUTH_LOGIN_FAILED",
        severity: "WARN",
        actor: email.toLowerCase().trim(),
        details: "Non-existent user email login attempt",
        ipAddress: clientIp,
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    // Check account suspension
    if (user.is_suspended === 1) {
      await logSecurityEvent({
        eventType: "AUTH_LOGIN_BLOCKED_SUSPENDED",
        severity: "CRITICAL",
        actor: user.email,
        details: "Login blocked for suspended account",
        ipAddress: clientIp,
      });
      return res.status(403).json({ error: "Your account has been suspended for security policy violations. Contact security@vynor.lk" });
    }

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      await logSecurityEvent({
        eventType: "AUTH_LOGIN_FAILED",
        severity: "WARN",
        actor: user.email,
        details: "Incorrect password entered",
        ipAddress: clientIp,
      });
      return res.status(401).json({ error: "Invalid email or password" });
    }

    await logSecurityEvent({
      eventType: "AUTH_LOGIN_SUCCESS",
      severity: "INFO",
      actor: user.email,
      target: user.id,
      details: "User authenticated successfully",
      ipAddress: clientIp,
    });

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

// Get current user profile + active subscription + security status
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
        allowedIps: user.allowed_ips || "",
        isSuspended: false,
        emailVerified: user.email_verified === 1,
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

// Resend Verification Email (or OTP)
authRouter.post("/send-verification", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  try {
    if (user.email_verified === 1) {
      return res.json({ success: true, message: "Email is already verified." });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const verifyToken = uuidv4().replace(/-/g, "");
    const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();

    const otpHash = crypto.createHash("sha256").update(otpCode).digest("hex");
    const tokenHash = crypto.createHash("sha256").update(verifyToken).digest("hex");

    await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [user.id]);
    await dbRun(
      "INSERT INTO email_verifications (id, user_id, email, otp_hash, token_hash, attempts, expires_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      [uuidv4(), user.id, user.email, otpHash, tokenHash, expiresAt]
    );

    sendVerificationEmail(user.email, user.name || "", otpCode, verifyToken).catch(console.error);

    res.json({ success: true, message: `Verification code sent to ${user.email}.` });
  } catch (err: any) {
    console.error("Send verification error:", err);
    res.status(500).json({ error: "Failed to send verification email" });
  }
});

// Verify Email with OTP (Hash-Only Verification & Attempt Limiter)
authRouter.post("/verify-email", requireAuth, async (req: Request, res: Response) => {
  const user = (req as any).user;
  const { otp } = req.body;
  const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";

  if (!otp || typeof otp !== "string" || otp.trim().length !== 6) {
    return res.status(400).json({ error: "A valid 6-digit verification code is required." });
  }

  try {
    const inputOtpHash = crypto.createHash("sha256").update(otp.trim()).digest("hex");
    const record = await dbGet<any>(
      `SELECT * FROM email_verifications
       WHERE user_id = ? AND otp_hash = ? AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
      [user.id, inputOtpHash, new Date().toISOString()]
    );

    if (!record) {
      await dbRun("UPDATE email_verifications SET attempts = attempts + 1 WHERE user_id = ?", [user.id]);
      return res.status(400).json({ error: "Invalid or expired verification code." });
    }

    if (record.attempts >= 5) {
      await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [user.id]);
      return res.status(400).json({ error: "Too many failed attempts. Please request a new verification code." });
    }

    await dbRun("UPDATE users SET email_verified = 1 WHERE id = ?", [user.id]);
    await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [user.id]);

    await logSecurityEvent({
      eventType: "EMAIL_VERIFIED",
      severity: "INFO",
      actor: user.email,
      target: user.id,
      details: "Email address verified via 6-digit OTP hash",
      ipAddress: clientIp,
    });

    res.json({ success: true, message: "Email successfully verified!" });
  } catch (err: any) {
    console.error("Verify email error:", err);
    res.status(500).json({ error: "Verification failed." });
  }
});

// Verify Email via URL Link (Hash-Only Verification)
authRouter.get("/verify-email", async (req: Request, res: Response) => {
  const token = req.query.token as string;
  if (!token) return res.status(400).send("Verification token is required.");

  try {
    const inputTokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");
    const record = await dbGet<any>(
      `SELECT * FROM email_verifications WHERE token_hash = ? AND expires_at > ? LIMIT 1`,
      [inputTokenHash, new Date().toISOString()]
    );

    if (!record) {
      return res.status(400).send("Invalid or expired verification link. Please request a new code.");
    }

    await dbRun("UPDATE users SET email_verified = 1 WHERE id = ?", [record.user_id]);
    await dbRun("DELETE FROM email_verifications WHERE user_id = ?", [record.user_id]);

    await logSecurityEvent({
      eventType: "EMAIL_VERIFIED",
      severity: "INFO",
      actor: record.email,
      target: record.user_id,
      details: "Email address verified via one-click link",
    });

    res.redirect("/index.html?emailVerified=true");
  } catch (err) {
    res.status(500).send("Error verifying email.");
  }
});

// Rotate API Key (Key lifecycle management like OpenAI/Kimi/Codex)
authRouter.post("/rotate-key", requireAuth, async (req: Request, res: Response) => {
  const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
  try {
    const user = (req as any).user;
    const newApiKey = `vynor_live_${uuidv4().replace(/-/g, "")}`;
    const newApiKeyHash = crypto.createHash("sha256").update(newApiKey).digest("hex");

    await dbRun("UPDATE users SET api_key = ?, api_key_hash = ? WHERE id = ?", [newApiKey, newApiKeyHash, user.id]);

    await logSecurityEvent({
      eventType: "KEY_ROTATED",
      severity: "INFO",
      actor: user.email,
      target: user.id,
      details: "User rotated their API Key. Previous key immediately revoked.",
      ipAddress: clientIp,
    });

    res.json({
      success: true,
      apiKey: newApiKey,
      message: "API Key rolled successfully. Previous key revoked immediately. Please update your VS Code extension settings.",
    });
  } catch (err: any) {
    console.error("Rotate key error:", err);
    res.status(500).json({ error: "Failed to rotate API Key" });
  }
});

// Set Allowed IPs (OpenAI/Kimi-style IP Whitelisting)
authRouter.post("/allowed-ips", requireAuth, async (req: Request, res: Response) => {
  const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
  try {
    const user = (req as any).user;
    const { allowedIps } = req.body;

    const sanitized = typeof allowedIps === "string" ? allowedIps.trim() : "";
    await dbRun("UPDATE users SET allowed_ips = ? WHERE id = ?", [sanitized, user.id]);

    await logSecurityEvent({
      eventType: "IP_RESTRICTIONS_UPDATED",
      severity: "INFO",
      actor: user.email,
      target: user.id,
      details: sanitized ? `Allowed IPs restricted to: ${sanitized}` : "Allowed IPs restriction cleared (global access)",
      ipAddress: clientIp,
    });

    res.json({
      success: true,
      allowedIps: sanitized,
      message: sanitized ? `API access restricted to: ${sanitized}` : "IP restriction removed. Key accessible anywhere.",
    });
  } catch (err: any) {
    console.error("Allowed IPs update error:", err);
    res.status(500).json({ error: "Failed to update IP restrictions" });
  }
});

// Get User's Personal Security Events & Audit Trail
authRouter.get("/security-logs", requireAuth, async (req: Request, res: Response) => {
  try {
    const user = (req as any).user;
    const events = await getUserSecurityEvents(user.email, 15);
    res.json({ events });
  } catch (err: any) {
    res.status(500).json({ error: "Failed to fetch security logs" });
  }
});

// Change Password
authRouter.post("/change-password", requireAuth, async (req: Request, res: Response) => {
  const clientIp = (req.headers["cf-connecting-ip"] as string) || req.ip || "unknown";
  try {
    const user = (req as any).user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current password and new password are required" });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const dbUser = await dbGet<any>("SELECT password_hash FROM users WHERE id = ?", [user.id]);
    const isMatch = await bcrypt.compare(currentPassword, dbUser.password_hash);
    if (!isMatch) {
      await logSecurityEvent({
        eventType: "PASSWORD_CHANGE_FAILED",
        severity: "WARN",
        actor: user.email,
        details: "Failed password change: current password incorrect",
        ipAddress: clientIp,
      });
      return res.status(400).json({ error: "Incorrect current password" });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await dbRun("UPDATE users SET password_hash = ? WHERE id = ?", [newHash, user.id]);

    await logSecurityEvent({
      eventType: "PASSWORD_CHANGED",
      severity: "INFO",
      actor: user.email,
      target: user.id,
      details: "User password changed successfully",
      ipAddress: clientIp,
    });

    res.json({ success: true, message: "Password updated successfully" });
  } catch (err: any) {
    console.error("Change password error:", err);
    res.status(500).json({ error: "Failed to change password" });
  }
});
