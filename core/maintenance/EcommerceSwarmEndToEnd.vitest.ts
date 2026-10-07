import { describe, expect, it } from "vitest";
import { MaintenanceSwarmEngine } from "./MaintenanceSwarmEngine";
import { IssueTriageProvider } from "./IssueTriageProvider";
import type { ProjectBlueprint } from "./types";

describe("E-Commerce Full-Stack Autonomous Swarm (End-to-End Verification)", () => {
  // 1. Definition matching VynorAI's 7-Stage Architectural Blueprint for E-Commerce
  const ECOMMERCE_BLUEPRINT: ProjectBlueprint = {
    id: "ecommerce",
    name: "Full-Stack E-Commerce Platform",
    description:
      "Production-ready e-commerce store with product catalog, cart, PayHere LKR checkout, customer auth, and order emails.",
    keywords: [
      "ecommerce",
      "e-commerce",
      "online store",
      "shopping cart",
      "sell products",
    ],
    stages: [
      {
        stageNumber: 1,
        stageName: "Core Environment & Database Config",
        description:
          "Set up type-safe .env validation, database connection pool, and CORS headers.",
        scaffoldIds: ["config.env", "config.database", "config.cors"],
      },
      {
        stageNumber: 2,
        stageName: "Database Models (Users, Products, Orders)",
        description:
          "Create relational tables with indexes, foreign keys, and soft deletes for products and orders.",
        scaffoldIds: ["db.users_model", "db.migration", "db.soft_delete"],
      },
      {
        stageNumber: 3,
        stageName: "Customer Authentication & Security",
        description:
          "Secure customer registration, login with bcrypt password hashing, and rate-limiting against brute force.",
        scaffoldIds: [
          "auth.registration",
          "auth.login",
          "security.rate_limiting",
          "security.headers",
        ],
      },
      {
        stageNumber: 4,
        stageName: "Products Catalog & Cart APIs",
        description:
          "CRUD API routes for products with keyset pagination, category filtering, and full-text search.",
        scaffoldIds: ["api.crud_routes", "db.pagination", "db.search"],
      },
      {
        stageNumber: 5,
        stageName: "Payment Gateway & Webhook (PayHere / Stripe)",
        description:
          "Generate MD5 checkout payment hash, handle IPN webhook callbacks, and generate order invoices.",
        scaffoldIds: [
          "payment.payhere_checkout",
          "payment.payhere_webhook",
          "payment.invoice_record",
        ],
      },
      {
        stageNumber: 6,
        stageName: "Product Images & Storage",
        description:
          "Presigned direct S3/R2 upload URLs and Sharp WebP image compression.",
        scaffoldIds: ["storage.s3_adapter", "storage.image_optimize"],
      },
      {
        stageNumber: 7,
        stageName: "Order Notification & Automated Smoke Test",
        description:
          "Order confirmation email dispatch and automated production smoke test.",
        scaffoldIds: [
          "comm.email_sender",
          "comm.welcome_email",
          "testing.smoke_test",
        ],
      },
    ],
  };

  it("converts a single e-commerce request into 7 ordered autonomous swarm stages", () => {
    const issues =
      MaintenanceSwarmEngine.createIssuesFromBlueprint(ECOMMERCE_BLUEPRINT);
    expect(issues.length).toBe(7);

    // Verify sequential stage IDs
    for (let i = 0; i < 7; i++) {
      expect(issues[i].id).toBe(`ECOMMERCE-STAGE-${i + 1}`);
      expect(issues[i].source).toBe("blueprint_stage");
      expect(issues[i].severity).toBe("high");
      expect(issues[i].targetFiles?.length).toBeGreaterThan(0);
    }

    // Verify stage 1 targets config files
    expect(issues[0].targetFiles).toContain("src/config/env.ts");
    expect(issues[0].targetFiles).toContain("src/config/database.ts");

    // Verify stage 5 targets PayHere payment files
    expect(issues[4].targetFiles).toContain("src/payment/payhere_checkout.ts");
    expect(issues[4].targetFiles).toContain("src/payment/payhere_webhook.ts");
  });

  it("prioritizes and sorts all 7 blueprint stages in strict architectural order", () => {
    const issues =
      MaintenanceSwarmEngine.createIssuesFromBlueprint(ECOMMERCE_BLUEPRINT);
    // Shuffle the issues to test sorting resilience
    const shuffled = [...issues].reverse();

    const sorted = IssueTriageProvider.prioritize(shuffled, 7);
    expect(sorted.length).toBe(7);

    // Ensure Stage 1 executes before Stage 2, etc.
    expect(sorted[0].id).toBe("ECOMMERCE-STAGE-1");
    expect(sorted[1].id).toBe("ECOMMERCE-STAGE-2");
    expect(sorted[2].id).toBe("ECOMMERCE-STAGE-3");
    expect(sorted[3].id).toBe("ECOMMERCE-STAGE-4");
    expect(sorted[4].id).toBe("ECOMMERCE-STAGE-5");
    expect(sorted[5].id).toBe("ECOMMERCE-STAGE-6");
    expect(sorted[6].id).toBe("ECOMMERCE-STAGE-7");
  });

  it("executes the entire 7-stage e-commerce build autonomously and generates morning briefing with 7 ready PRs", async () => {
    const engine = new MaintenanceSwarmEngine("/dummy/ecommerce-workspace", {
      maxConcurrentTasks: 1,
      maxTasksPerRun: 7,
      autoPrCreation: true,
      baseBranch: "main",
      branchPrefix: "vynor/auto-fix-",
      worktreeDir: "/tmp/worktrees",
      briefingOutputDir: "/tmp/briefings",
      dryRun: true,
    });

    const issues =
      MaintenanceSwarmEngine.createIssuesFromBlueprint(ECOMMERCE_BLUEPRINT);
    const report = await engine.runSwarm(issues);

    // 1. Verify all 7 stages scanned and completed
    expect(report.totalIssuesScanned).toBe(7);
    expect(report.prsCreated.length).toBe(7);

    // 2. Verify each stage has a distinct branch, reproduction test, and verification evidence
    for (let i = 0; i < 7; i++) {
      const pr = report.prsCreated[i];
      const stageNum = i + 1;
      expect(pr.status).toBe("pr_created");
      expect(pr.branchName).toBe(`vynor/auto-fix-ecommerce-stage-${stageNum}`);
      expect(pr.reproductionTestPath).toBe(
        `tests/repro-ecommerce-stage-${stageNum}.test.ts`,
      );
      expect(pr.verificationEvidence).toContain("passed");
      expect(pr.prUrl).toContain(`ecommerce-stage-${stageNum}`);
    }

    // 3. Verify the final Morning Briefing document contains full architectural summary
    const briefing = report.markdownBriefing;
    expect(briefing).toContain("VynorAI Self-Driving Maintenance Briefing");
    expect(briefing).toContain("Pull Requests Ready for Review (7)");
    expect(briefing).toContain("Core Environment & Database Config");
    expect(briefing).toContain("Database Models (Users, Products, Orders)");
    expect(briefing).toContain("Customer Authentication & Security");
    expect(briefing).toContain("Products Catalog & Cart APIs");
    expect(briefing).toContain("Payment Gateway & Webhook (PayHere / Stripe)");
    expect(briefing).toContain("Product Images & Storage");
    expect(briefing).toContain("Order Notification & Automated Smoke Test");
  });
});
