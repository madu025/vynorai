import { safeEqual } from "./secureId.js";
import crypto from "crypto";
import { config } from "../config.js";

/**
 * Fail closed on a half-configured gateway. An empty merchant secret makes the IPN signature key
 * md5("") which is public, so anyone could forge a paid notification. Called at boot (index.ts).
 */
export function assertPayhereConfig(
  payhere: {
    merchantId: string;
    merchantSecret: string;
    env: string;
  } = config.payhere,
): void {
  const hasId = Boolean(payhere.merchantId);
  const hasSecret = Boolean(payhere.merchantSecret);
  if (hasId && !hasSecret)
    throw new Error(
      "PAYHERE_MERCHANT_ID is set but PAYHERE_MERCHANT_SECRET is empty: IPN signatures would be forgeable",
    );
  if (payhere.env === "live" && !(hasId && hasSecret))
    throw new Error(
      "PAYHERE_ENV=live requires both PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET",
    );
}

/**
 * Generate PayHere Checkout Form Hash
 * Hash = strtoupper(md5(merchant_id + order_id + number_format(amount, 2, '.', '') + currency + strtoupper(md5(merchant_secret))))
 */
export function generatePayhereHash(
  orderId: string,
  amount: number,
  currency: string = "LKR",
): string {
  const formattedAmount = amount.toFixed(2);
  const hashedSecret = crypto
    .createHash("md5")
    .update(config.payhere.merchantSecret)
    .digest("hex")
    .toUpperCase();

  const hashString = `${config.payhere.merchantId}${orderId}${formattedAmount}${currency}${hashedSecret}`;
  return crypto
    .createHash("md5")
    .update(hashString)
    .digest("hex")
    .toUpperCase();
}

/**
 * Verify PayHere IPN (Instant Payment Notification) Signature
 * local_md5sig = strtoupper(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + strtoupper(md5(merchant_secret))))
 */
export function verifyPayhereIpn(body: Record<string, any>): boolean {
  const merchantId = body.merchant_id;
  const orderId = body.order_id;
  const payhereAmount = body.payhere_amount;
  const payhereCurrency = body.payhere_currency;
  const statusCode = body.status_code;
  const receivedMd5sig = body.md5sig;

  if (!receivedMd5sig || !merchantId || !orderId) {
    return false;
  }
  // An empty secret or merchant id gives a publicly computable signature key: never verify with it.
  if (!config.payhere.merchantSecret || !config.payhere.merchantId) {
    return false;
  }

  const hashedSecret = crypto
    .createHash("md5")
    .update(config.payhere.merchantSecret)
    .digest("hex")
    .toUpperCase();

  const hashString = `${merchantId}${orderId}${payhereAmount}${payhereCurrency}${statusCode}${hashedSecret}`;
  const localMd5sig = crypto
    .createHash("md5")
    .update(hashString)
    .digest("hex")
    .toUpperCase();

  return (
    typeof receivedMd5sig === "string" &&
    safeEqual(receivedMd5sig.toUpperCase(), localMd5sig)
  );
}
