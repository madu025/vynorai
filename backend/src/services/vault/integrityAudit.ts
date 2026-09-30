import crypto from "crypto";
import { AuditLogEntry, GoldenTemplate } from "./types.js";

const auditTrail: AuditLogEntry[] = [];

/**
 * Compute cryptographic SHA-256 checksum for a Golden Template.
 */
export function computeTemplateChecksum(t: Partial<GoldenTemplate>): string {
  const canonicalPayload = JSON.stringify({
    id: t.id,
    version: t.version,
    code: t.code?.trim(),
    dependencies: t.dependencies || [],
    requiredEnv: t.requiredEnv || [],
  });
  return crypto.createHash("sha256").update(canonicalPayload).digest("hex");
}

/**
 * Verify template integrity against stored checksum.
 */
export function verifyTemplateIntegrity(t: GoldenTemplate): { valid: boolean; currentChecksum: string; storedChecksum: string } {
  const currentChecksum = computeTemplateChecksum(t);
  return {
    valid: t.checksum ? currentChecksum === t.checksum : true,
    currentChecksum,
    storedChecksum: t.checksum || "",
  };
}

/**
 * Log an audit entry into the immutable ledger.
 */
export function logVaultAudit(entry: Omit<AuditLogEntry, "id" | "timestamp">): AuditLogEntry {
  const record: AuditLogEntry = {
    id: `audit_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  auditTrail.push(record);
  return record;
}

export function getAuditTrail(filterTemplateId?: string): AuditLogEntry[] {
  if (filterTemplateId) {
    return auditTrail.filter((a) => a.templateId === filterTemplateId);
  }
  return [...auditTrail];
}
