import { dbRun, dbAll } from "../db.js";
import { v4 as uuidv4 } from "uuid";

export type SecuritySeverity = "INFO" | "WARN" | "CRITICAL";

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
export async function logSecurityEvent(options: SecurityEventOptions): Promise<void> {
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
      [id, eventType, severity, actor, target, details, ipAddress]
    );
  } catch (err) {
    // Non-blocking: security logging shouldn't crash the main pipeline
    console.error("[SecurityAudit] Failed to log security event:", err);
  }
}

/**
 * Fetch recent audit events for admin inspection
 */
export async function getRecentSecurityEvents(limit = 100, eventType?: string): Promise<any[]> {
  try {
    if (eventType) {
      return await dbAll(
        `SELECT * FROM security_audit_logs WHERE event_type LIKE ? ORDER BY created_at DESC LIMIT ?`,
        [`%${eventType}%`, limit]
      );
    }
    return await dbAll(
      `SELECT * FROM security_audit_logs ORDER BY created_at DESC LIMIT ?`,
      [limit]
    );
  } catch (err) {
    console.error("[SecurityAudit] Failed to fetch events:", err);
    return [];
  }
}

/**
 * Fetch user-specific security events (e.g. logins, key rotations)
 */
export async function getUserSecurityEvents(userIdOrEmail: string, limit = 20): Promise<any[]> {
  try {
    return await dbAll(
      `SELECT event_type, severity, details, ip_address, created_at
       FROM security_audit_logs
       WHERE actor = ? OR target = ?
       ORDER BY created_at DESC LIMIT ?`,
      [userIdOrEmail, userIdOrEmail, limit]
    );
  } catch (err) {
    console.error("[SecurityAudit] Failed to fetch user events:", err);
    return [];
  }
}
