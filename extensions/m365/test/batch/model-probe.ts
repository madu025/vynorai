/** One-off: ask the real model for the steps of given requests on a dataset. npx tsx --env-file=../../.env.e2e test/batch/model-probe.ts retail "request one" "request two" */
import { buildSchemaSummary } from "../../src/analysis.js";
import {
  buildScriptMessages,
  parseScriptResponse,
} from "../../../../backend/src/services/m365Script.js";
import { DATASETS } from "./datasets500.js";

const [id, ...requests] = process.argv.slice(2);
const dataset = DATASETS.find((item) => item.id === id);
if (!dataset) throw new Error("unknown dataset");
const summary = buildSchemaSummary({
  workbookId: "w",
  worksheetName: dataset.sheet,
  address: "A1:K301",
  hasHeaders: true,
  values: [dataset.columns.map((column) => column.name), ...dataset.rows],
} as any);
for (const request of requests) {
  const response = await fetch(
    `${process.env.VYNOR_E2E_API_BASE || "https://vynor.lk"}/v1/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.VYNORAI_E2E_API_KEY}`,
      },
      body: JSON.stringify({
        model: "vynor-auto",
        messages: buildScriptMessages(summary, "en", request),
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
    },
  );
  const json: any = await response.json();
  const steps = parseScriptResponse(
    String(json?.choices?.[0]?.message?.content ?? ""),
  ).steps.map((step) => step.instruction);
  console.log(JSON.stringify(request), "->", JSON.stringify(steps));
}
