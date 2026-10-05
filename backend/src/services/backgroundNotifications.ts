import crypto from "crypto";
import webpush from "web-push";
import { v4 as uuidv4 } from "uuid";
import { billingAll as dbAll, billingRun as dbRun } from "./billingDb.js";
import { decryptCredential, encryptCredential } from "./credentialVault.js";

function configure(): boolean {
  const publicKey = process.env.BG_VAPID_PUBLIC_KEY;
  const privateKey = process.env.BG_VAPID_PRIVATE_KEY;
  const subject = process.env.BG_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  return true;
}

export function pushPublicKey(): string | null {
  return process.env.BG_VAPID_PUBLIC_KEY || null;
}

export async function savePushSubscription(
  userId: string,
  value: any,
): Promise<string> {
  const endpoint = typeof value?.endpoint === "string" ? value.endpoint : "";
  const p256dh =
    typeof value?.keys?.p256dh === "string" ? value.keys.p256dh : "";
  const auth = typeof value?.keys?.auth === "string" ? value.keys.auth : "";
  if (
    !/^https:\/\//.test(endpoint) ||
    endpoint.length > 2048 ||
    !p256dh ||
    !auth
  )
    throw new Error("INVALID_PUSH_SUBSCRIPTION");
  const encrypted = [endpoint, p256dh, auth].map(encryptCredential);
  if (encrypted.some((item) => !item))
    throw new Error("DATA_ENCRYPTION_KEY_NOT_CONFIGURED");
  const digest = crypto.createHash("sha256").update(endpoint).digest("hex");
  const id = uuidv4();
  await dbRun(
    `INSERT INTO web_push_subscriptions
     (id, user_id, endpoint_digest, endpoint_ciphertext, p256dh_ciphertext, auth_ciphertext)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, endpoint_digest) DO UPDATE SET endpoint_ciphertext = ?,
       p256dh_ciphertext = ?, auth_ciphertext = ?, revoked_at = NULL, last_used_at = CURRENT_TIMESTAMP`,
    [
      id,
      userId,
      digest,
      encrypted[0],
      encrypted[1],
      encrypted[2],
      encrypted[0],
      encrypted[1],
      encrypted[2],
    ],
  );
  return id;
}

export async function revokePushSubscription(
  userId: string,
  endpoint: string,
): Promise<void> {
  const digest = crypto.createHash("sha256").update(endpoint).digest("hex");
  await dbRun(
    "UPDATE web_push_subscriptions SET revoked_at = CURRENT_TIMESTAMP WHERE user_id = ? AND endpoint_digest = ?",
    [userId, digest],
  );
}

export async function sendBackgroundPush(
  userId: string,
  payload: {
    taskId: string;
    status: string;
    passed: number;
    total: number;
    highestRisk?: string;
  },
): Promise<void> {
  if (!configure()) return;
  const rows = await dbAll<any>(
    "SELECT * FROM web_push_subscriptions WHERE user_id = ? AND revoked_at IS NULL",
    [userId],
  );
  for (const row of rows) {
    const endpoint = decryptCredential(row.endpoint_ciphertext);
    const p256dh = decryptCredential(row.p256dh_ciphertext);
    const auth = decryptCredential(row.auth_ciphertext);
    if (!endpoint || !p256dh || !auth) continue;
    try {
      await webpush.sendNotification(
        { endpoint, keys: { p256dh, auth } },
        JSON.stringify(payload),
        { TTL: 3600, urgency: "normal" },
      );
      await dbRun(
        "UPDATE web_push_subscriptions SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?",
        [row.id],
      );
    } catch (error: any) {
      if ([404, 410].includes(Number(error?.statusCode)))
        await dbRun(
          "UPDATE web_push_subscriptions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?",
          [row.id],
        );
    }
  }
}
