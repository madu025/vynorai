import { databaseStatus, dbAll, dbGet, dbRun } from "../db.js";

/**
 * Billing queries used to be split between PostgreSQL and a SQLite mirror.
 * The whole database now runs on one engine (db.ts), so these are aliases kept
 * for the existing imports.
 */
export const billingGet = dbGet;
export const billingAll = dbAll;
export const billingRun = dbRun;

export function billingDbStatus(): {
  mode: "sqlite" | "postgres";
  ready: boolean;
} {
  const status = databaseStatus();
  return { mode: status.driver, ready: status.ready };
}
