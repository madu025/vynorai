import { Request, Response, NextFunction } from "express";
import { monthlyQuotaGuard } from "./monthlyQuota.js";

/**
 * Re-export monthlyQuotaGuard as quotaGuard for backward compatibility.
 */
export const quotaGuard = monthlyQuotaGuard;

/**
 * Estimate rough input token count from messages (4 chars ≈ 1 token).
 */
export function estimateInputTokens(messages: any[]): number {
  if (!messages || !Array.isArray(messages)) return 0;
  let chars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part?.text) chars += part.text.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}
