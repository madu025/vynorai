import { GOLDEN_TEMPLATES, detectTemplateIntent, checkInstantTemplateMatch } from "./src/services/templateVault.js";
import { indexProjectFiles, getProjectMap, retrieveTopChunks, getUserChunks, clearUserIndex } from "./src/services/ragEngine.js";
import { generateZKUserId, computeAuditHash } from "./src/services/zkShield.js";

async function runTests() {
  console.log("=================================================");
  console.log("🚀 VYNORAI ENTERPRISE TEST SUITE: FULL VERIFICATION");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, details?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}${details ? ` (${details})` : ""}`);
      failed++;
    }
  }

  // ── TEST 1: Golden Template Vault Integrity ─────────────────────────────────
  console.log("\n📦 1. TESTING GOLDEN TEMPLATES VAULT...");
  assert(GOLDEN_TEMPLATES.length >= 7, "Vault contains required pre-vetted templates", `Found ${GOLDEN_TEMPLATES.length}`);
  
  const expectedTemplates = [
    "sl-mobile-validator",
    "sl-nic-parser",
    "payhere-lkr-gateway",
    "jwt-auth-rotation",
    "security-headers-ratelimit",
    "db-users-schema",
    "nextjs-app-auth",
    "fastapi-jwt-auth",
    "prisma-production-schema"
  ];
  for (const tId of expectedTemplates) {
    const found = GOLDEN_TEMPLATES.find(t => t.id === tId);
    assert(!!found, `Template '${tId}' exists and has code`, `Found: ${!!found}`);
  }

  // ── TEST 2: Instant 0-Token Slash Command & Direct Matches ─────────────────
  console.log("\n⚡ 2. TESTING 0-TOKEN INSTANT DETERMINISTIC DELIVERY...");
  const slashTest1 = checkInstantTemplateMatch("/template sl-phone");
  assert(slashTest1.matched === true, "Slash command /template sl-phone matched");
  assert(slashTest1.template?.id === "sl-mobile-validator", "Correct template ID matched (sl-mobile-validator)");
  assert(slashTest1.responseMarkdown?.includes("07") === true, "Markdown contains phone regex logic");

  const slashTest2 = checkInstantTemplateMatch("give me payhere hash code in typescript");
  assert(slashTest2.matched === true, "Direct phrase 'give me payhere hash code' matched");
  assert(slashTest2.template?.id === "payhere-lkr-gateway", "Matched payhere-lkr-gateway");

  const slashTest3 = checkInstantTemplateMatch("give me nextjs auth boilerplate");
  assert(slashTest3.matched === true, "Direct phrase 'give me nextjs auth boilerplate' matched");
  assert(slashTest3.template?.id === "nextjs-app-auth", "Matched nextjs-app-auth");

  // ── TEST 3: Intent Detection for RAG Injection ──────────────────────────────
  console.log("\n🎯 3. TESTING INTENT DETECTION FOR RAG PIPELINE...");
  const intent1 = detectTemplateIntent("I need to validate national identity card in my app");
  assert(intent1?.id === "sl-nic-parser", "Detected SL NIC intent from natural language");

  const intent2 = detectTemplateIntent("How do I setup refresh token rotation and bcrypt in express?");
  assert(intent2?.id === "jwt-auth-rotation", "Detected JWT auth rotation intent");

  const intent3 = detectTemplateIntent("Show me prisma model for users and subscriptions");
  assert(intent3?.id === "prisma-production-schema", "Detected Prisma schema intent");

  // ── TEST 4: Universal Multi-Language Project Indexer & Smart RAG ────────────
  console.log("\n🌐 4. TESTING UNIVERSAL MULTI-LANGUAGE PROJECT INDEX MAPPING...");
  const testUserId = "user_test_" + Date.now();
  clearUserIndex(testUserId);

  const testProjectFiles = [
    {
      path: "services/auth.ts",
      content: `export async function verifyUserToken(token: string) {\n  return token === 'secret';\n}\n\nexport class AuthController {\n  login() { return true; }\n}`
    },
    {
      path: "main.py",
      content: `def calculate_interest_rate(principal, rate):\n    return principal * rate\n\nclass PaymentManager:\n    def process_sl_payment(self):\n        pass`
    },
    {
      path: "server.go",
      content: `package main\n\nfunc HandleWebhookRoute(w http.ResponseWriter, r *http.Request) {\n    fmt.Println("Webhook received")\n}\n\ntype OrderService struct {\n    ID string\n}`
    },
    {
      path: "UserController.java",
      content: `public class UserController {\n    public void registerNewAccount() {\n        System.out.println("Registering");\n    }\n}`
    },
    {
      path: "auth.php",
      content: `<?php\nclass AuthenticationProvider {\n    public function authenticateSession() {\n        return true;\n    }\n}`
    }
  ];

  const projectMap = indexProjectFiles(testUserId, "my-enterprise-app", testProjectFiles);
  assert(projectMap.fileCount === 5, "Indexed 5 files across 5 different languages");
  assert(projectMap.chunkCount >= 5, "Generated semantic chunks across all languages", `Chunks: ${projectMap.chunkCount}`);
  assert(projectMap.symbolCount >= 5, "Extracted AST symbols across TS, Python, Go, Java, PHP", `Symbols: ${projectMap.symbolCount}`);
  assert(projectMap.languages.includes("ts") && projectMap.languages.includes("py") && projectMap.languages.includes("go"), "Detected languages TS, Python, Go");

  // Check symbol-weighted retrieval
  const userChunks = getUserChunks(testUserId);
  const retrieved = retrieveTopChunks("How does verifyUserToken work in auth?", userChunks, 3, projectMap);
  assert(retrieved.length > 0, "Retrieved top chunks for user query");
  assert(retrieved[0].name.toLowerCase().includes("verifyusertoken"), "Symbol-weighted bonus ranked verifyUserToken as #1 chunk");

  // ── TEST 5: Blockchain Zero-Knowledge ID & Merkle Hash Integrity ───────────
  console.log("\n⛓️ 5. TESTING BLOCKCHAIN MERKLE AUDIT CHAIN & ZK-ID...");
  const zkId1 = generateZKUserId("user_real_email@gmail.com");
  const zkId2 = generateZKUserId("user_real_email@gmail.com");
  assert(zkId1.startsWith("zk_vynor_"), "ZK-ID formatted with prefix zk_vynor_");
  assert(zkId1 === zkId2, "Deterministic HMAC-SHA256 within the same day");
  assert(!zkId1.includes("gmail.com"), "Zero leakage of user email in ZK-ID");

  // Merkle Hash Chaining simulation
  const genesisHash = "GENESIS_BLOCK_VYNORAI_0000000000000000";
  const block1Hash = computeAuditHash(genesisHash, { userId: "u1", tokens: 100, ts: 1000 });
  const block2Hash = computeAuditHash(block1Hash, { userId: "u1", tokens: 250, ts: 1001 });
  const block3Hash = computeAuditHash(block2Hash, { userId: "u1", tokens: 500, ts: 1002 });

  assert(block1Hash !== genesisHash, "Block 1 computed unique SHA-256 hash");
  assert(block2Hash !== block1Hash, "Block 2 chained onto Block 1 hash");
  assert(block3Hash !== block2Hash, "Block 3 chained onto Block 2 hash");

  // Verify tampering detection
  const tamperedBlock1Hash = computeAuditHash(genesisHash, { userId: "u1", tokens: 999999, ts: 1000 }); // Hacker edited tokens!
  assert(tamperedBlock1Hash !== block1Hash, "Tampered tokens immediately break the cryptographic hash");

  // ── TEST 6: 100-Template Compound Scaffold Registry ────────────────────────
  console.log("\n📚 6. TESTING 100-TEMPLATE COMPOUND SCAFFOLD REGISTRY...");
  const { getScaffoldCatalog, resolveCompoundScaffold } = await import("./src/services/scaffoldRegistry.js");
  const catalog = getScaffoldCatalog();
  assert(catalog.domains.length === 11, "All 11 enterprise domains represented", `Found ${catalog.domains.length} domains`);
  assert(catalog.count >= 60, "Catalog contains 60+ pre-mapped production templates", `Found ${catalog.count} templates`);

  const paymentPkg = resolveCompoundScaffold("payment.payhere_checkout");
  assert(!!paymentPkg, "Resolved compound package 'payment.payhere_checkout'");
  assert(paymentPkg?.files.length === 2, "Payment package contains multiple files (service + route)");
  assert(paymentPkg?.securityChecklist.length === 3, "Contains mandatory security checklist");
  assert(paymentPkg?.tests.length === 1, "Contains automated unit test suite");

  // ── TEST 7: Composite Project Blueprints (E-Commerce & SaaS) ──────────────
  console.log("\n🏗️ 7. TESTING COMPOSITE PROJECT BLUEPRINTS & STAGE PLANNER...");
  const { detectProjectBlueprint, formatBlueprintPlan } = await import("./src/services/scaffoldRegistry.js");
  const ecomBp = detectProjectBlueprint("Mata ecommerce web ekak hadala denna");
  assert(!!ecomBp, "Detected E-Commerce Blueprint from natural user request");
  assert(ecomBp?.id === "ecommerce", "Blueprint ID is 'ecommerce'");
  assert(ecomBp?.stages.length === 7, "E-Commerce roadmap contains 7 production stages", `Stages: ${ecomBp?.stages.length}`);
  
  const formattedPlan = formatBlueprintPlan(ecomBp!);
  assert(formattedPlan.includes("Full-Stack E-Commerce Platform"), "Plan contains platform name");
  assert(formattedPlan.includes("Stage 1: **Core Environment & Database Config**"), "Plan outlines Stage 1");
  assert(formattedPlan.includes("payment.payhere_checkout"), "Stage 5 includes PayHere LKR checkout template");

  const saasBp = detectProjectBlueprint("Build a multi-tenant B2B SaaS platform");
  assert(!!saasBp && saasBp.id === "saas_platform", "Detected B2B SaaS blueprint with team & subscriptions");

  // ── TEST 8: Deep Edge-Case Verification for Upgraded VPS Templates ─────────
  console.log("\n🧪 8. TESTING DEEP REAL-WORLD EDGE CASES IN VPS TEMPLATES...");
  const { normalizeSLPhone, parseSLNIC, generatePayHereHash, verifyPayHereWebhook } = await import("./src/services/templateVault.js");

  // 8.1 Sri Lanka Mobile & Landline Validator Edge Cases
  const phoneDialog = normalizeSLPhone("077 123 4567");
  assert(phoneDialog.isValid && phoneDialog.type === "MOBILE" && phoneDialog.operator === "Dialog" && phoneDialog.canReceiveSMS, "Dialog mobile parsed (077 123 4567)");
  assert(phoneDialog.e164 === "+94771234567", "Normalized to E.164 (+94771234567)");

  const phoneMobitel = normalizeSLPhone("+94 71 999 8888");
  assert(phoneMobitel.isValid && phoneMobitel.operator === "Mobitel", "Mobitel parsed (+94 71 999 8888)");

  const phoneHutch = normalizeSLPhone("0094781234567");
  assert(phoneHutch.isValid && phoneHutch.operator === "Hutch", "Hutch parsed with 0094 prefix");

  const phoneAirtel = normalizeSLPhone("0751112233");
  assert(phoneAirtel.isValid && phoneAirtel.operator === "Airtel", "Airtel parsed (0751112233)");

  const phoneLandline = normalizeSLPhone("011 234 5678");
  assert(phoneLandline.isValid && phoneLandline.type === "LANDLINE" && phoneLandline.area === "Colombo" && !phoneLandline.canReceiveSMS, "Colombo Landline parsed (cannot receive SMS)");

  const phoneKandy = normalizeSLPhone("+94 81 223 4567");
  assert(phoneKandy.isValid && phoneKandy.type === "LANDLINE" && phoneKandy.area === "Kandy", "Kandy Landline parsed");

  const phoneInvalid = normalizeSLPhone("077123"); // Too short
  assert(!phoneInvalid.isValid, "Rejected invalid short phone (077123)");

  // 8.2 Sri Lanka Dual-Standard NIC Parser Edge Cases
  const nicOldMale = parseSLNIC("851234567V");
  assert(nicOldMale.isValid && nicOldMale.format === "OLD" && nicOldMale.birthYear === 1985 && nicOldMale.gender === "MALE", "Old Male NIC parsed (851234567V)");
  assert(nicOldMale.monthName === "May" && nicOldMale.dateOfBirth === "1985-05-02", "Exact DOB calculated (1985-05-02)");
  assert(nicOldMale.age >= 38, `Accurate age calculated (${nicOldMale.age})`);
  assert(nicOldMale.isVoter === true, "Voter status confirmed for 'V'");
  assert(nicOldMale.newFormatEquivalent === "198512304567", "Converted to 12-digit equivalent format");

  const nicOldFemale = parseSLNIC("926234567X");
  assert(nicOldFemale.isValid && nicOldFemale.gender === "FEMALE" && nicOldFemale.dayOfYear === 123, "Old Female NIC day offset adjusted (623 -> 123)");
  assert(nicOldFemale.isVoter === false, "Alien/ineligible voter status confirmed for 'X'");

  const nicNew = parseSLNIC("200115501234");
  assert(nicNew.isValid && nicNew.format === "NEW" && nicNew.birthYear === 2001 && nicNew.gender === "MALE", "New 12-digit NIC parsed (200115501234)");

  const nicInvalidDay = parseSLNIC("900004567V"); // Day of year 0 is invalid
  assert(!nicInvalidDay.isValid, "NIC with day 0 correctly rejected");

  const nicInvalidRange = parseSLNIC("959994567V"); // 999 - 500 = 499 > 366
  assert(!nicInvalidRange.isValid, "NIC with day > 366 correctly rejected");

  // 8.3 PayHere Gateway Hash & IPN Status Code Validation
  const merchantSecret = "4XXSuperSecret123";
  const hash = generatePayHereHash("123456", "ORDER_99", 1500, "LKR", merchantSecret);
  assert(hash.length === 32, "Generated valid 32-character PayHere checkout MD5 hash");

  // Calculate matching signature for IPN
  const crypto = await import("crypto");
  const hashedSecret = crypto.createHash("md5").update(merchantSecret).digest("hex").toUpperCase();
  const validSigSuccess = crypto.createHash("md5").update("123456" + "ORDER_99" + "1500.00" + "LKR" + "2" + hashedSecret).digest("hex").toUpperCase();
  
  const ipnSuccess = verifyPayHereWebhook({
    merchant_id: "123456",
    order_id: "ORDER_99",
    payment_id: "PAY_112233",
    payhere_amount: "1500.00",
    payhere_currency: "LKR",
    status_code: "2",
    md5sig: validSigSuccess
  }, merchantSecret);
  assert(ipnSuccess.isValidSignature && ipnSuccess.isPaid && ipnSuccess.status === "SUCCESS", "PayHere IPN verified as PAID for status_code 2");

  // Canceled payment with valid signature (Customer clicked Cancel)
  const validSigCanceled = crypto.createHash("md5").update("123456" + "ORDER_99" + "1500.00" + "LKR" + "-1" + hashedSecret).digest("hex").toUpperCase();
  const ipnCanceled = verifyPayHereWebhook({
    merchant_id: "123456",
    order_id: "ORDER_99",
    payment_id: "PAY_112233",
    payhere_amount: "1500.00",
    payhere_currency: "LKR",
    status_code: "-1",
    md5sig: validSigCanceled
  }, merchantSecret);
  assert(ipnCanceled.isValidSignature && !ipnCanceled.isPaid && ipnCanceled.status === "CANCELED", "PayHere Canceled IPN correctly recognized as NOT PAID");

  // Tampered payment (Hacker tried to lower amount)
  const ipnTampered = verifyPayHereWebhook({
    merchant_id: "123456",
    order_id: "ORDER_99",
    payment_id: "PAY_112233",
    payhere_amount: "1.00", // Tampered!
    payhere_currency: "LKR",
    status_code: "2",
    md5sig: validSigSuccess
  }, merchantSecret);
  assert(!ipnTampered.isValidSignature && !ipnTampered.isPaid, "Tampered amount caught by signature verifier");

  // ── TEST 9: Multi-Token Weighted Scoring Engine & Validation Pipeline ─────
  console.log("\n⚖️ 9. TESTING WEIGHTED SCORING ENGINE & ENTERPRISE VALIDATION...");
  const {
    scoreTemplateMatch,
    validateTemplateConfig,
    validateTemplateCompatibility,
    validateTemplateSecurity,
    detectTemplateIntentWithScore
  } = await import("./src/services/templateVault.js");

  // 9.1 Multi-Token Weighted Scoring
  const payhereQueryScored = detectTemplateIntentWithScore("PayHere add කරන්න. merchant ID එක config එකෙන් ගන්න.");
  assert(payhereQueryScored.confidence === "HIGH", "High confidence match for PayHere Natural Language Request", `Score: ${payhereQueryScored.score}`);
  assert(payhereQueryScored.template?.id === "payhere-lkr-gateway", "Matched 'payhere-lkr-gateway' over generic payments");
  assert(payhereQueryScored.score >= 35, `Score is >= 35 (Actual: ${payhereQueryScored.score})`);

  const nicScored = detectTemplateIntentWithScore("How to validate Sri Lanka NIC and calculate date of birth?");
  assert(nicScored.confidence === "HIGH" && nicScored.template?.id === "sl-nic-parser", "High confidence match for SL NIC parser with DOB");

  const genericIrrelevant = detectTemplateIntentWithScore("Can you help me design a weather forecast graphic?");
  assert(genericIrrelevant.template === null && genericIrrelevant.confidence === "NONE", "Irrelevant query safely routed away from templates (confidence: NONE)");

  // 9.2 Config Validation Layer
  const payhereTemplate = GOLDEN_TEMPLATES.find(t => t.id === "payhere-lkr-gateway")!;
  const invalidConfigCheck = validateTemplateConfig(payhereTemplate, { merchantId: "12345" }, {});
  assert(!invalidConfigCheck.isValid, "Config validation fails when required secret or env is missing");
  assert(invalidConfigCheck.missingParams.includes("merchantSecret"), "Identified missing required config parameter: merchantSecret");

  const validConfigCheck = validateTemplateConfig(payhereTemplate, {
    merchantId: "12345",
    merchantSecret: "sec_998877",
    currency: "LKR"
  }, {
    PAYHERE_MERCHANT_ID: "12345",
    PAYHERE_MERCHANT_SECRET: "sec_998877",
    PAYHERE_CURRENCY: "LKR"
  });
  assert(validConfigCheck.isValid, "Config validation passes with all required parameters and env variables");

  // 9.3 Compatibility Validation Layer
  const nextjsTemplate = GOLDEN_TEMPLATES.find(t => t.id === "nextjs-app-auth")!;
  const compatibleNext15 = validateTemplateCompatibility(nextjsTemplate, {
    framework: "nextjs",
    frameworkVersion: "15.4.0",
    nodeVersion: "20.10.0"
  });
  assert(compatibleNext15.isCompatible, "Next.js 15.4 is compatible with nextjs-app-auth template");

  const incompatibleNext12 = validateTemplateCompatibility(nextjsTemplate, {
    framework: "nextjs",
    frameworkVersion: "12.2.0",
    nodeVersion: "16.0.0"
  });
  assert(!incompatibleNext12.isCompatible, "Incompatible Next.js 12 flagged and prevented from injection");
  assert(incompatibleNext12.reasons.some(r => r.includes("Next.js version mismatch")), "Explains Next.js version mismatch in reasons");

  // 9.4 Security Layer Verification Across All Vault Templates
  let allTemplatesSecure = true;
  for (const t of GOLDEN_TEMPLATES) {
    const sec = validateTemplateSecurity(t);
    if (!sec.passed) {
      allTemplatesSecure = false;
      console.error(`Security vulnerability in ${t.id}:`, sec.securityIssues);
    }
  }
  assert(allTemplatesSecure, "All 9 Golden Templates pass zero-fallback secret & modern CSP security checks");

  // ── TEST 10: 4-Tier Intent Router & Confidence Classification ─────────────
  console.log("\n🚦 10. TESTING 4-TIER INTENT ROUTER & CONFIDENCE CLASSIFICATION...");
  const { classifyIntentAndRoute } = await import("./src/services/templateVault.js");

  const tier1 = classifyIntentAndRoute("PayHere payment add කරන්න", GOLDEN_TEMPLATES);
  assert(tier1.tier === "DIRECT_EXECUTE" && tier1.confidence >= 0.90, "Confidence >= 0.90 -> DIRECT_EXECUTE tier (PayHere)", `Confidence: ${tier1.confidence}`);
  assert(tier1.template?.id === "payhere-lkr-gateway", "Target template is payhere-lkr-gateway");

  const tier2 = classifyIntentAndRoute("nic date of birth check", GOLDEN_TEMPLATES);
  assert(tier2.tier === "VALIDATE_AND_EXECUTE" || tier2.tier === "DIRECT_EXECUTE", "Intent matched for SL NIC date of birth");

  const tier4 = classifyIntentAndRoute("Write me a poem about the sunrise in Kandy", GOLDEN_TEMPLATES);
  assert(tier4.tier === "FALLBACK_LLM" && tier4.confidence < 0.50, "Unmatched creative prompt -> FALLBACK_LLM tier (< 0.50)");

  // ── TEST 11: Project Context Scanner ──────────────────────────────────────
  console.log("\n🔍 11. TESTING PROJECT CONTEXT SCANNER...");
  const { scanProjectFiles } = await import("./src/services/templateVault.js");
  const scannedContext = scanProjectFiles([
    {
      path: "package.json",
      content: JSON.stringify({
        dependencies: { next: "^15.4.0", "@prisma/client": "^5.0.0", pg: "^8.11.0" },
        devDependencies: { typescript: "^5.3.0" },
        engines: { node: ">=20.0.0" }
      })
    },
    {
      path: "prisma/schema.prisma",
      content: 'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}'
    },
    {
      path: ".env",
      content: "DATABASE_URL=postgresql://localhost:5432/db\nJWT_SECRET=supersecret\n"
    }
  ]);

  assert(scannedContext.framework === "nextjs" && scannedContext.frameworkVersion?.startsWith("15"), "Detected Next.js 15 framework");
  assert(scannedContext.language === "typescript", "Detected TypeScript language");
  assert(scannedContext.orm === "prisma", "Detected Prisma ORM");
  assert(scannedContext.database === "postgresql", "Detected PostgreSQL database");
  assert(scannedContext.existingEnvKeys?.includes("DATABASE_URL"), "Extracted DATABASE_URL from .env");

  // ── TEST 12: Template Dependency Graph Composer ───────────────────────────
  console.log("\n🧩 12. TESTING TEMPLATE COMPOSER & DEPENDENCY GRAPH (DAG)...");
  const { composeTemplatePipeline } = await import("./src/services/templateVault.js");
  const composed = composeTemplatePipeline("payhere-lkr-gateway", GOLDEN_TEMPLATES);
  assert(composed.rootTemplateId === "payhere-lkr-gateway", "Root template identified");
  assert(composed.files.length >= 1, "Composed multi-file package from pipeline");
  assert(composed.dependencies.length >= 1, "Aggregated production dependencies");

  // ── TEST 13: AST Patch Engine & Protected Section Guard ───────────────────
  console.log("\n🩹 13. TESTING AST PATCH ENGINE & DO_NOT_MODIFY GUARDS...");
  const { applyFilePatches } = await import("./src/services/templateVault.js");
  const initialFiles = {
    "app/api/payhere/route.ts": `// @vynor:protected(signature_verification)\nfunction verifySignature() { return true; }\nexport default function handler() {}`
  };

  // Safe patch
  const safePatch = applyFilePatches(initialFiles, [
    {
      file: "app/api/payhere/route.ts",
      type: "ADD_IMPORT",
      targetAnchor: "",
      payload: "import crypto from 'crypto';"
    }
  ]);
  assert(safePatch.success && safePatch.modifiedFiles.includes("app/api/payhere/route.ts"), "Safely applied ADD_IMPORT to target file");

  // Violating patch on DO_NOT_MODIFY section
  const hackPatch = applyFilePatches(initialFiles, [
    {
      file: "app/api/payhere/route.ts",
      type: "REPLACE_BLOCK",
      targetAnchor: "signature_verification",
      payload: "signature_verification_hacked"
    }
  ], ["signature_verification"]);
  assert(!hackPatch.success && hackPatch.errors.some(e => e.includes("SECURITY VIOLATION")), "DO_NOT_MODIFY guard blocked tampering of signature_verification");

  // ── TEST 14: Idempotency & Snapshot Rollback Manager ───────────────────────
  console.log("\n⏪ 14. TESTING IDEMPOTENCY & SNAPSHOT ROLLBACK MANAGER...");
  const { createProjectSnapshot, restoreProjectSnapshot, isTemplateInstalled } = await import("./src/services/templateVault.js");

  const projectState = {
    "services/payhere_lkr_gateway.ts": `// @vynor:template(payhere-lkr-gateway)\nexport const config = {};`
  };
  const installCheck = isTemplateInstalled("payhere-lkr-gateway", projectState);
  assert(installCheck.installed === true, "Idempotency engine detected already-installed template");

  const snapId = createProjectSnapshot({ "file.ts": "original code" });
  const restored = restoreProjectSnapshot(snapId);
  assert(restored?.["file.ts"] === "original code", "Restored exact snapshot state on rollback");

  // ── TEST 15: Checksum Integrity & Audit Ledger ─────────────────────────────
  console.log("\n🔏 15. TESTING CRYPTOGRAPHIC CHECKSUMS & AUDIT LEDGER...");
  const { computeTemplateChecksum, verifyTemplateIntegrity, logVaultAudit, getAuditTrail } = await import("./src/services/templateVault.js");

  const testT = GOLDEN_TEMPLATES[0];
  const checksum = computeTemplateChecksum(testT);
  assert(checksum.length === 64, "Generated valid 64-char SHA-256 template checksum");
  const integrity = verifyTemplateIntegrity(testT);
  assert(integrity.valid, "Template integrity verified against stored cryptographic hash");

  const auditEntry = logVaultAudit({
    templateId: testT.id,
    version: testT.version,
    action: "INSTALL",
    status: "PASSED",
    riskLevel: testT.riskLevel || "low",
    project: "vynor-ecom-client",
    checksum
  });
  assert(auditEntry.id.startsWith("audit_"), "Logged audit trail entry");
  assert(getAuditTrail(testT.id).length >= 1, "Retrieved audit trail history for template");

  // ── TEST 16: 50 Database Vibe-Coding Guardrails ───────────────────────────
  console.log("\n🛡️ 16. TESTING 50 DATABASE VIBE-CODING GUARDRAILS...");
  const { validateDatabaseSchema } = await import("./src/services/vault/databaseGuardrails.js");

  // Case 1: Bad Vibe-Coded SQL with money FLOAT, missing PK, destructive drop, and SQLi
  const badSQL = `
    DROP TABLE IF EXISTS old_users;
    CREATE TABLE orders (
      order_id VARCHAR(36),
      total_amount FLOAT,
      user_id VARCHAR(36)
    );
    const query = \`SELECT * FROM users WHERE id = '\${userId}'\`;
  `;
  const badReport = validateDatabaseSchema(badSQL, { isMultiTenant: true });
  assert(!badReport.passed, "Bad vibe-coded database schema correctly failed validation");
  assert(badReport.violations.some(v => v.code === "DESTRUCTIVE_MIGRATION"), "Caught DESTRUCTIVE_MIGRATION (DROP TABLE)");
  assert(badReport.violations.some(v => v.code === "MONEY_FLOATING_POINT_PRECISION"), "Caught MONEY_FLOATING_POINT_PRECISION (FLOAT amount)");
  assert(badReport.violations.some(v => v.code === "MISSING_PRIMARY_KEY"), "Caught MISSING_PRIMARY_KEY");
  assert(badReport.violations.some(v => v.code === "RAW_SQL_INJECTION_RISK"), "Caught RAW_SQL_INJECTION_RISK in template query");

  // Case 2: Enterprise Production-Grade SQL
  const goodSQL = `
    CREATE TABLE orders (
      id VARCHAR(36) PRIMARY KEY,
      tenant_id VARCHAR(36) NOT NULL,
      total_amount DECIMAL(12,2) NOT NULL,
      user_id VARCHAR(36) NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    CREATE INDEX idx_orders_user_id ON orders(user_id);
    CREATE INDEX idx_orders_tenant ON orders(tenant_id);
  `;
  const goodReport = validateDatabaseSchema(goodSQL, { isMultiTenant: true });
  assert(goodReport.passed, "Enterprise production-grade database schema passed all 50 guardrails with 0 critical violations");

  // ── TEST 17: 5-Layer Local Engineering Architecture ────────────────────────
  console.log("\n🏗️ 17. TESTING 5-LAYER LOCAL ENGINEERING SYSTEM (Templates, Rules, Validators, Workflows, Tools)...");
  const {
    VYNOR_REGISTRY,
    RULES_REGISTRY,
    evaluateRules,
    WORKFLOW_REGISTRY,
    executeWorkflow,
    runUnifiedValidators,
    validateSecurity,
    ExecutionTools,
    executeVynorEngine,
  } = await import("./src/services/templateVault.js");

  // 1. Layer 1: Templates Registry
  assert(VYNOR_REGISTRY.templates.count() >= 5, `Layer 1: Templates registry initialized with ${VYNOR_REGISTRY.templates.count()} templates`);
  const payhereT = VYNOR_REGISTRY.templates.get("payhere-lkr-gateway");
  assert(payhereT !== undefined, "Layer 1: Retrieved payhere-lkr-gateway golden template");

  // 2. Layer 2: Rules Registry & Rejection of Money FLOAT
  assert(VYNOR_REGISTRY.rules.count() >= 5, `Layer 2: Rules registry active with ${VYNOR_REGISTRY.rules.count()} engineering rules`);
  const ruleReject = evaluateRules({
    schema: "CREATE TABLE payments ( id VARCHAR(36), amount FLOAT );",
  });
  assert(!ruleReject.passed, "Layer 2: Local Rule Engine rejected FLOAT for financial column");
  assert(ruleReject.violations.some((v: any) => v.ruleId === "db.never_use_float_for_money"), "Layer 2: Correctly matched 'never_use_float_for_money' rule violation");
  assert(ruleReject.violations[0].suggestion?.includes("DECIMAL"), "Layer 2: Provided deterministic suggestion: DECIMAL(12,2)");

  // 3. Layer 3: Validators Layer & Targeted Surgical Error Reporting
  const secReport = validateSecurity('const secret = process.env.API_KEY || "change_this_in_production";');
  assert(!secReport.passed, "Layer 3: Security validator detected insecure fallback secret");
  assert(secReport.suggestions.length > 0, "Layer 3: Emitted targeted fix suggestions without needing full project context");

  // 4. Layer 4: Workflows Engine
  assert(WORKFLOW_REGISTRY["add-payment"] !== undefined, "Layer 4: 'add-payment' workflow registered");
  assert(WORKFLOW_REGISTRY["add-database-table"] !== undefined, "Layer 4: 'add-database-table' workflow registered");
  assert(WORKFLOW_REGISTRY["add-database-table"].steps.length === 12, "Layer 4: 'add-database-table' workflow has all 12 deterministic engineering steps");

  // 5. Layer 5: Execution Tools (Filesystem, Database, Git diff, Testing)
  const layer5Files: Record<string, string> = {
    "src/index.ts": 'console.log("Hello Vynor");\n',
  };
  const updatedFiles = ExecutionTools.filesystem.writeFile(layer5Files, "src/config.ts", 'export const PORT = 3000;\n');
  assert(updatedFiles["src/config.ts"] !== undefined, "Layer 5: Tool filesystem.writeFile executed");
  const diffStr = ExecutionTools.git.computeDiff(layer5Files["src/index.ts"], 'console.log("Hello Vynor AI");\n');
  assert(diffStr.includes("+ console.log(\"Hello Vynor AI\");"), "Layer 5: Tool git.computeDiff generated unified diff");

  // 6. Master Orchestrator: Zero-Token Pipeline for 'PayHere payment add කරන්න'
  const orchResult = await executeVynorEngine("PayHere payment add කරන්න", layer5Files, {
    schemaSQL: goodSQL,
  });
  assert(orchResult.status === "SUCCESS", `Master Orchestrator completed with status SUCCESS: ${orchResult.message}`);
  assert(orchResult.tokensConsumed === 0, "Master Orchestrator executed with exactly 0 LLM tokens!");
  assert(orchResult.workflowId === "add-payment", "Master Orchestrator auto-selected 'add-payment' workflow");
  assert(orchResult.diffs.length > 0, "Master Orchestrator generated file diffs ready for human approval");
  assert(orchResult.userApprovalRequired === true, "Master Orchestrator gated high-risk financial workflow behind human approval");

  // 7. Master Orchestrator: Surgical Pinpoint Repair on Schema Violation
  const orchFailed = await executeVynorEngine("Orders table add කරන්න", layer5Files, {
    schemaSQL: "CREATE TABLE bad_orders ( id VARCHAR(36), price FLOAT );",
  });
  assert(orchFailed.status === "VALIDATION_FAILED", "Master Orchestrator intercepted schema rule failure");
  assert(orchFailed.surgicalFeedbackForLLM !== undefined, "Master Orchestrator generated pinpoint surgical feedback for AI repair");
  assert(orchFailed.surgicalFeedbackForLLM!.violations.some((v: string) => v.includes("never_use_float_for_money")), "Surgical feedback pinpointed exact money rule violation");

  console.log("\n=================================================");
  console.log(`🏁 TEST RESULTS: ${passed} PASSED | ${failed} FAILED`);
  console.log("=================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
