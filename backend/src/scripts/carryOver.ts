/**
 * One-time carry-over from the retired text-timestamp PostgreSQL database into a new database built
 * from the typed baseline. See services/pgCarryOver.ts and docs/DB_CUTOVER_RUNBOOK.md.
 *
 *   OLD_DATABASE_URL=postgres://... NEW_DATABASE_URL=postgres://... \
 *     npx tsx src/scripts/carryOver.ts [--dry-run] [--init-schema]
 *
 * KEPT_EMAIL overrides the kept test account. --init-schema applies the typed baseline when the
 * new database is empty. The report lists table names and counts only.
 */
import { DEFAULT_KEPT_EMAIL, runCarryOver } from "../services/pgCarryOver.js";

async function main(): Promise<void> {
  const oldUrl = process.env.OLD_DATABASE_URL;
  const newUrl = process.env.NEW_DATABASE_URL;
  if (!oldUrl || !newUrl) {
    console.error("Set OLD_DATABASE_URL and NEW_DATABASE_URL.");
    process.exit(2);
  }
  const dryRun = process.argv.includes("--dry-run");
  const report = await runCarryOver({
    oldUrl,
    newUrl,
    keptEmail: process.env.KEPT_EMAIL || DEFAULT_KEPT_EMAIL,
    dryRun,
    initSchema: process.argv.includes("--init-schema"),
  });
  console.log(
    `Carry-over ${dryRun ? "dry run (rolled back)" : "committed"}; kept test account ${report.keptUserFound ? "found" : "NOT found"}.`,
  );
  for (const t of report.tables) {
    console.log(
      `${t.table.padEnd(22)} read=${t.read} inserted=${t.inserted} alreadyPresent=${t.alreadyPresent} skipped=${t.skipped}`,
    );
    for (const w of t.warnings) console.log(`  warning: ${w}`);
  }
}

main().catch((error: Error) => {
  // The message names the failed rule; it never contains row values or connection strings.
  console.error(`Carry-over failed: ${error.message}`);
  process.exit(1);
});
