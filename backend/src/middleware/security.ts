import { Request, Response, NextFunction } from "express";
import { incrementRateLimit } from "../services/redisStore.js";

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const memoryStore = new Map<string, RateLimitRecord>();

// Periodic cleanup of stale entries every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    for (const [key, record] of memoryStore.entries()) {
      if (now > record.resetAt) {
        memoryStore.delete(key);
      }
    }
  },
  5 * 60 * 1000,
).unref(); // never keep the process (or a test run) alive

/**
 * High-performance, zero-dependency in-memory rate limiter
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) {
  const {
    windowMs,
    max,
    message = "Too many requests. Please try again later.",
    keyGenerator = (req: Request) => {
      // Prioritize Cloudflare CF-Connecting-IP, then X-Forwarded-For, then socket remoteAddress
      const cfIp = req.headers["cf-connecting-ip"];
      if (typeof cfIp === "string") return cfIp;
      const xff = req.headers["x-forwarded-for"];
      if (typeof xff === "string") return xff.split(",")[0].trim();
      return req.ip || req.socket.remoteAddress || "unknown_ip";
    },
  } = options;

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = keyGenerator(req);
    const now = Date.now();
    let count: number;
    let resetSeconds: number;

    try {
      const distributed = await incrementRateLimit(key, windowMs);
      if (distributed) {
        count = distributed.count;
        resetSeconds = Math.max(1, Math.ceil(distributed.ttlMs / 1000));
      } else {
        throw new Error("Redis unavailable");
      }
    } catch {
      // Single-node fallback preserves availability. Production health exposes
      // degraded Redis so operators do not mistake this for distributed safety.
      let record = memoryStore.get(key);
      if (!record || now > record.resetAt) {
        record = { count: 1, resetAt: now + windowMs };
        memoryStore.set(key, record);
      } else {
        record.count += 1;
      }
      count = record.count;
      resetSeconds = Math.ceil((record.resetAt - now) / 1000);
    }

    const remaining = Math.max(0, max - count);

    res.setHeader("X-RateLimit-Limit", max);
    res.setHeader("X-RateLimit-Remaining", remaining);
    res.setHeader("X-RateLimit-Reset", resetSeconds);

    if (count > max) {
      res.setHeader("Retry-After", resetSeconds);
      return res.status(429).json({
        error: {
          message,
          type: "rate_limit_exceeded",
          code: "too_many_requests",
          retryAfterSeconds: resetSeconds,
        },
      });
    }

    next();
  };
}

/**
 * 1. Auth Rate Limiter: Max 5 register/login attempts per 1 minute per IP
 */
export const AUTH_RATE_LIMIT_PER_MINUTE = 10;
export const PROXY_RATE_LIMIT_PER_MINUTE = 60;

export const authRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: AUTH_RATE_LIMIT_PER_MINUTE,
  message:
    "Too many authentication attempts from this IP. Please wait 1 minute before trying again.",
  keyGenerator: (req) => {
    const ip =
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"] ||
      req.ip ||
      "unknown";
    return `auth_${ip}`;
  },
});

/**
 * 2. AI Proxy Concurrency/Burst Limiter: Max 60 requests per minute per User/API Token
 */
export const proxyRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  max: PROXY_RATE_LIMIT_PER_MINUTE,
  message:
    "VynorAI proxy rate limit reached (max 60 calls/minute). Please slow down.",
  keyGenerator: (req) => {
    const user = (req as any).user;
    if (user?.id) return `proxy_user_${user.id}`;
    const authHeader = req.headers.authorization;
    if (authHeader) return `proxy_token_${authHeader}`;
    const ip = req.headers["cf-connecting-ip"] || req.ip || "unknown";
    return `proxy_ip_${ip}`;
  },
});

/**
 * 3. Security Headers Middleware (OWASP recommended headers)
 */
export function securityHeadersMiddleware(
  _req: Request,
  res: Response,
  next: NextFunction,
) {
  // Prevent clickjacking
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  // Prevent MIME-sniffing
  res.setHeader("X-Content-Type-Options", "nosniff");
  // XSS Auditor
  res.setHeader("X-XSS-Protection", "1; mode=block");
  // Referrer Policy
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  // Permissions Policy
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  // Strict-Transport-Security (HSTS)
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload",
  );
  // Content Security Policy. The pages still use inline scripts and handlers,
  // so 'unsafe-inline' stays; the gain is that injected script cannot load
  // remote code, send data to another host, or post forms anywhere but
  // PayHere. 127.0.0.1/localhost is the IDE sign-in callback.
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' data: https://fonts.gstatic.com",
      "img-src 'self' data:",
      "connect-src 'self' http://127.0.0.1:* http://localhost:*",
      "frame-src https://challenges.cloudflare.com",
      "form-action 'self' https://www.payhere.lk https://sandbox.payhere.lk",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join("; "),
  );
  // Hide Express server footprint
  res.removeHeader("X-Powered-By");

  next();
}
