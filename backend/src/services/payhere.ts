import crypto from "crypto";
import { config } from "../config.js";

/**
 * Generate PayHere Checkout Form Hash
 * Hash = strtoupper(md5(merchant_id + order_id + number_format(amount, 2, '.', '') + currency + strtoupper(md5(merchant_secret))))
 */
export function generatePayhereHash(
  orderId: string,
  amount: number,
  currency: string = "LKR"
): string {
  const formattedAmount = amount.toFixed(2);
  const hashedSecret = crypto
    .createHash("md5")
    .update(config.payhere.merchantSecret)
    .digest("hex")
    .toUpperCase();

  const hashString = `${config.payhere.merchantId}${orderId}${formattedAmount}${currency}${hashedSecret}`;
  return crypto.createHash("md5").update(hashString).digest("hex").toUpperCase();
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

  const hashedSecret = crypto
    .createHash("md5")
    .update(config.payhere.merchantSecret)
    .digest("hex")
    .toUpperCase();

  const hashString = `${merchantId}${orderId}${payhereAmount}${payhereCurrency}${statusCode}${hashedSecret}`;
  const localMd5sig = crypto.createHash("md5").update(hashString).digest("hex").toUpperCase();

  return receivedMd5sig.toUpperCase() === localMd5sig;
}
