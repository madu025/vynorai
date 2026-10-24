import { dbRun, dbAll } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export type SecuritySeverity = "INFO" | "WARN" | "CRITICAL";

/** `actor` and `target` are VARCHAR(128) on PostgreSQL. */
export const AUDIT_SUBJECT_MAX = 128;
export const AUDIT_DETAILS_MAX = 4000;

/**
 * Audit text is attacker-influenced (login names, headers, ids): strip control characters so one
 * value cannot forge extra log lines, and cap the length so a single request cannot bloat the table
 * or fail the insert on the VARCHAR columns.
 */
export function cleanAuditField(
  value: unknown,
  max: number,
  keepNewlines = false,
): string {
  const text = String(value ?? "");
  const pattern = keepNewlines
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return text.replace(pattern, "").slice(0, max);
}

/** Escapes LIKE wildcards so a filter string is matched literally (use with ESCAPE '\\'). */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

export interface SecurityEventOptions {
  eventType: string;
  severity?: SecuritySeverity;
  actor: string;
  target?: string;
  details?: string;
  ipAddress?: string;
}

/**
 * Log a security-related action or threat detection to the database
 */
export async function logSecurityEvent(
  options: SecurityEventOptions,
): Promise<void> {
  const {
    eventType,
    severity = "INFO",
    actor,
    target = "",
    details = "",
    ipAddress = "unknown",
  } = options;

  try {
    const id = uuidv4();
    await dbRun(
      `INSERT INTO security_audit_logs (id, event_type, severity, actor, target, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        cleanAuditField(eventType, 64),
        severity,
        cleanAuditField(actor, AUDIT_SUBJECT_MAX),
        cleanAuditField(target, AUDIT_SUBJECT_MAX),
        cleanAuditField(details, AUDIT_DETAILS_MAX, true),
        cleanAuditField(ipAddress, 64),
      ],
    );
  } catch (err) {
    // Non-blocking: security logging shouldn't crash the main pipeline
    console.error("[SecurityAudit] Failed to log security event:", err);
  }
}

/**
 * Fetch recent audit events for admin inspection
 */
export async function getRecentSecurityEvents(
  limit = 100,
  eventType?: string,
): Promise<any[]> {
  try {
    if (eventType) {
      return await dbAll(
        `SELECT * FROM security_audit_logs WHERE event_type LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?`,
        [`%${escapeLike(eventType)}%`, limit],
      );
    }
    return await dbAll(
      `SELECT * FROM security_audit_logs ORDER BY created_at DESC LIMIT ?`,
      [limit],
    );
  } catch (err) {
    console.error("[SecurityAudit] Failed to fetch events:", err);
    return [];
  }
}

/**
 * Fetch user-specific security events (e.g. logins, key rotations)
 */
export async function getUserSecurityEvents(
  userIdOrEmail: string | string[],
  limit = 20,
): Promise<any[]> {
  try {
    const subjects = (
      Array.isArray(userIdOrEmail) ? userIdOrEmail : [userIdOrEmail]
    )
      .filter((value) => typeof value === "string" && value.length > 0)
      .slice(0, 4);
    if (subjects.length === 0) return [];
    // Placeholders only (one "?" per subject, at most 4): never a value.
    const SUBJECT_PLACEHOLDERS = subjects.map(() => "?").join(", ");
    return await dbAll(
      `SELECT event_type, severity, details, ip_address, created_at
       FROM security_audit_logs
       WHERE actor IN (${SUBJECT_PLACEHOLDERS}) OR target IN (${SUBJECT_PLACEHOLDERS})
       ORDER BY created_at DESC LIMIT ?`,
      [...subjects, ...subjects, limit],
    );
  } catch (err) {
    console.error("[SecurityAudit] Failed to fetch user events:", err);
    return [];
  }
}
