import jwt from "jsonwebtoken";
import { config } from "../config.js";

export interface BackgroundModelClaims {
  taskId: string;
  userId: string;
  scope: "background:model";
}

function secret(): string {
  const value = process.env.BG_MODEL_TOKEN_SECRET || config.jwtSecret;
  if (config.nodeEnv === "production" && !process.env.BG_MODEL_TOKEN_SECRET)
    throw new Error("BG_MODEL_TOKEN_SECRET is required in production");
  return value;
}

export function mintBackgroundModelToken(
  taskId: string,
  userId: string,
): string {
  return jwt.sign({ taskId, userId, scope: "background:model" }, secret(), {
    audience: "vynor-background-model",
    issuer: "vynor-background-worker",
    expiresIn: "50m",
    jwtid: `${taskId}:${Date.now()}`,
  });
}

export function verifyBackgroundModelToken(
  token: string,
): BackgroundModelClaims {
  const claims = jwt.verify(token, secret(), {
    audience: "vynor-background-model",
    issuer: "vynor-background-worker",
  }) as BackgroundModelClaims;
  if (claims.scope !== "background:model" || !claims.taskId || !claims.userId)
    throw new Error("INVALID_BACKGROUND_MODEL_TOKEN");
  return claims;
}
