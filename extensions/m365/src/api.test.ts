import assert from "node:assert/strict";
import { test } from "node:test";
import { createM365ApiClient, M365ApiError } from "./api.js";

test("M365 API preserves structured policy errors for recovery UI", async () => {
  const client = createM365ApiClient(
    "https://api.example",
    "test-token",
    async () =>
      new Response(
        JSON.stringify({ error: { code: "invalid_entra_identity" } }),
        {
          status: 401,
          headers: { "content-type": "application/json" },
        },
      ),
  );

  await assert.rejects(
    () => client.planExcel({}),
    (error: unknown) =>
      error instanceof M365ApiError &&
      error.code === "invalid_entra_identity" &&
      error.status === 401,
  );
});
