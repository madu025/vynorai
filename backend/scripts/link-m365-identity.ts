import { initDb, dbRun } from "../src/db.js";

const tenantId = process.env.M365_LINK_TENANT_ID?.trim() || "";
const objectId = process.env.M365_LINK_OBJECT_ID?.trim() || "";
const userId = process.env.M365_LINK_USER_ID?.trim() || "";

if (!tenantId || !objectId || !userId) {
  throw new Error(
    "Set M365_LINK_TENANT_ID, M365_LINK_OBJECT_ID, and M365_LINK_USER_ID",
  );
}

await initDb();
await dbRun(
  `INSERT INTO m365_identity_links (tenant_id, object_id, user_id, enabled)
   VALUES (?, ?, ?, 1)
   ON CONFLICT(tenant_id, object_id) DO UPDATE SET user_id = excluded.user_id, enabled = 1`,
  [tenantId, objectId, userId],
);
console.log("M365 identity link enabled.");
