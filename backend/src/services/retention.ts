/**
 * Retention: deletes data older than the periods promised in
 * public/privacy.html. Runs on every worker shortly after start and then
 * daily; the deletes are idempotent, so two workers running it is harmless.
 */
import { dbRun } from "../db.js";

export const RETENTION_DAYS = {
  cache_entries: 30,
  request_economics: 365,
  usage_logs: 365,
  security_audit_logs: 365,
  email_verifications: 30,
} as const;

function cutoff(days: number): string {
  return new Date(Date.now() - days * 86400_000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
}

export async function runRetention(): Promise<Record<string, number | null>> {
  const removed: Record<string, number | null> = {};
  for (const [table, days] of Object.entries(RETENTION_DAYS)) {
    try {
      const result: any = await dbRun(
        `DELETE FROM ${table} WHERE created_at < ?`,
        [cutoff(days)],
      );
      removed[table] = result?.changes ?? result?.rowCount ?? null;
    } catch (err: any) {
      console.warn(`[Retention] ${table}: ${err.message}`);
      removed[table] = null;
    }
  }
  console.log("[Retention] removed:", JSON.stringify(removed));
  return removed;
}

export function scheduleRetention(): void {
  setTimeout(() => void runRetention(), 60_000).unref();
  setInterval(() => void runRetention(), 24 * 3600_000).unref();
}
