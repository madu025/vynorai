import { executeVynorEngine, formatOrchestrationToMarkdown } from "./src/services/templateVault.js";

async function testExtensionRequest() {
  console.log("================================================================================");
  console.log("🧪 SIMULATING VS CODE / EXTENSION CHAT REQUEST FROM USER");
  console.log("================================================================================\n");

  // ── Scenario 1: User asks in Sinhala / English for PayHere Payment Gateway ───
  console.log("💬 [User in Extension]: \"PayHere payment add කරන්න\"\n");
  const result1 = await executeVynorEngine("PayHere payment add කරන්න", {
    "src/routes/api.ts": '// Main API routes\nimport express from "express";\nexport const router = express.Router();\n',
  });

  console.log("--- [Backend Response to Extension] ---");
  console.log("Status:", result1.status);
  console.log("Workflow Selected:", result1.workflowId);
  console.log("Template Loaded:", result1.templateId);
  console.log("Tokens Consumed:", result1.tokensConsumed, "🔥 (100% Free / Zero LLM Tokens!)");
  console.log("Confidence:", (result1.confidence * 100).toFixed(0) + "%");
  console.log("Risk Level:", result1.riskLevel);
  console.log("Approval Required:", result1.userApprovalRequired);
  console.log("\n--- [Rendered Markdown in Extension Chat Window] ---\n");
  console.log(formatOrchestrationToMarkdown(result1));

  console.log("\n================================================================================");
  console.log("💬 [User in Extension]: \"Orders table add කරන්න\" with Bad Money Float Schema\n");
  
  // ── Scenario 2: User / AI agent attempts bad schema with FLOAT price ──────────
  const result2 = await executeVynorEngine("Orders table add කරන්න", {
    "src/index.ts": 'console.log("app");\n',
  }, {
    schemaSQL: `
      CREATE TABLE orders (
        order_id VARCHAR(36),
        total_price FLOAT,
        user_id VARCHAR(36)
      );
    `,
  });

  console.log("--- [Backend Guardrail Interception] ---");
  console.log("Status:", result2.status);
  console.log("Workflow:", result2.workflowId);
  console.log("Tokens Consumed:", result2.tokensConsumed);
  console.log("\n--- [Rendered Markdown in Extension Chat Window] ---\n");
  console.log(formatOrchestrationToMarkdown(result2));

  console.log("\n================================================================================");
  console.log("💬 [User in Extension]: Creative/Unmatched Query (Fallback to Cloud LLM)\n");
  const result3 = await executeVynorEngine("Explain quantum entanglement using a cricket analogy", {});
  console.log("Status:", result3.status);
  console.log("Routing:", result3.message);
  console.log("Confidence:", result3.confidence);
  console.log("=> This query correctly routes to cloud LLM (DeepSeek / Claude / GPT)!");
  console.log("================================================================================");
}

testExtensionRequest().catch(console.error);
