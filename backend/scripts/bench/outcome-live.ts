/**
 * Sends one task outcome through core's own postToVynor to the production
 * backend with a real key, then the caller reads the row from the database.
 *   VYNORAI_E2E_API_KEY=... npx tsx scripts/bench/outcome-live.ts
 */
import { postToVynor } from "../../../core/util/vynorBackend";

async function main() {
  const ok = await postToVynor(
    {
      apiBase: "https://vynor.lk/v1",
      apiKey: process.env.VYNORAI_E2E_API_KEY,
      providerName: "vynorai",
    },
    "task-outcomes",
    {
      outcome: "completed",
      mode: "agent",
      rounds: 4,
      credits: 1234,
      edited: true,
      verified: true,
      client: "live-check",
    },
  );
  console.log("posted:", ok);
  process.exit(ok ? 0 : 1);
}
void main();
