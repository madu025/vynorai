/**
 * Retention: deletes data older than the periods promised in
 * public/privacy.html. Runs on every worker shortly after start and then
 * daily; the deletes are idempotent, so two workers running it is harmless.
 */
import { dbAll, dbRun } from "../db.js";
import { deleteBackgroundArtifact } from "./backgroundArtifacts.js";
import { sweepLinkCodes } from "./m365Linking.js";

export const RETENTION_DAYS = {
  // Exact responses are usable for 24 hours; keep the fallback table bounded.
  cache_entries: 1,
  request_economics: 365,
  usage_logs: 365,
  security_audit_logs: 365,
  email_verifications: 30,
  routing_feedback: 365,
  error_reports: 90,
  task_outcomes: 180,
  // M365 tenant usage cycles: about 13 months, matching the usage history promised for usage_logs
  // plus one cycle of slack. Rows hold counts and ids only.
  m365_tenant_usage: 395,
} as const;

/**
 * Deliberately NOT purged here: `zk_compliance_audit_logs` is a Merkle hash chain (each row commits
 * to the previous one), so deleting old rows would make the whole chain unverifiable. It holds only
 * surrogate user ids and one-way fingerprints, never an email, prompt or code. This is an accepted,
 * documented exception to time-based deletion.
 */
export const RETENTION_EXCLUDED_TABLES = ["zk_compliance_audit_logs"] as const;

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
  try {
    const expired = await dbAll<{ id: string; task_id: string }>(
      "SELECT id, task_id FROM background_artifacts WHERE expires_at < ? AND deleted_at IS NULL LIMIT 500",
      [new Date().toISOString()],
    );
    for (const artifact of expired)
      await deleteBackgroundArtifact(artifact.id).catch(() => {});
    await dbRun(
      `UPDATE background_tasks SET prompt = NULL, proof = NULL, purged_at = COALESCE(purged_at, CURRENT_TIMESTAMP),
       status = CASE WHEN status IN ('completed','failed','canceled') THEN 'purged' ELSE status END,
       updated_at = CURRENT_TIMESTAMP
       WHERE purge_after < ? AND status IN ('completed','failed','canceled','purged')`,
      [new Date().toISOString()],
    );
    removed.background_artifacts = expired.length;
  } catch (err: any) {
    console.warn(`[Retention] background artifacts: ${err.message}`);
    removed.background_artifacts = null;
  }
  try {
    removed.m365_link_codes = await sweepLinkCodes();
  } catch (err: any) {
    console.warn(`[Retention] m365_link_codes: ${err.message}`);
    removed.m365_link_codes = null;
  }
  console.log("[Retention] removed:", JSON.stringify(removed));
  return removed;
}

export function scheduleRetention(): void {
  setTimeout(() => void runRetention(), 60_000).unref();
  setInterval(() => void runRetention(), 24 * 3600_000).unref();
}
