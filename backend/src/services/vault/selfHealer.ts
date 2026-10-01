/**
 * VynorAI Autonomous Template Self-Healing & Context-Correction Engine
 * -----------------------------------------------------------------------------
 * Inspects matched industry boilerplates against the target project context
 * (Node version, ESM vs CommonJS, framework version, missing imports) and
 * autonomously heals discrepancies before code reaches the developer.
 *
 * If a terminal error or compiler diagnostic is detected, isolates the failing
 * lines and surgically patches the template dynamically.
 */

import crypto from "crypto";
import { GoldenTemplate } from "./types.js";

export interface ProjectContext {
  framework?: string;
  language?: string;
  moduleSystem?: "commonjs" | "esm";
  nodeVersion?: number;
  dependencies?: Record<string, string>;
}

export interface SelfHealingResult {
  code: string;
  wasCorrected: boolean;
  corrections: string[];
  suggestedEnv: Record<string, string>;
  missingDependencies: string[];
}

/**
 * Autonomously heals and adapts a Golden Template for a specific project context
 */
export function healTemplateForContext(
  template: GoldenTemplate,
  context?: ProjectContext,
  errorTrace?: string
): SelfHealingResult {
  let code = template.code;
  const corrections: string[] = [];
  let wasCorrected = false;

  const moduleSystem = context?.moduleSystem || (context?.language === "javascript" && !context?.framework ? "commonjs" : "esm");

  // 1. Module System Alignment (ESM vs CommonJS)
  if (moduleSystem === "commonjs") {
    // Convert ESM imports to CommonJS requires if needed
    if (code.includes("import ") && !code.includes("require(")) {
      code = code.replace(/import\s+(\w+)\s+from\s+["']([^"']+)["'];?/g, "const $1 = require('$2');");
      code = code.replace(/import\s+\{\s*([^}]+)\s*\}\s+from\s+["']([^"']+)["'];?/g, "const { $1 } = require('$2');");
      code = code.replace(/export\s+default\s+([a-zA-Z0-9_$]+);?/g, "module.exports = $1;");
      code = code.replace(/export\s+(const|function|class)\s+([a-zA-Z0-9_$]+)/g, "$1 $2");
      corrections.push("Autonomously converted ESM syntax to CommonJS (require/module.exports)");
      wasCorrected = true;
    }
  } else {
    // Ensure TypeScript/ESM imports
    if (code.includes("require(") && !code.includes("import ")) {
      code = code.replace(/const\s+\{\s*([^}]+)\s*\}\s*=\s*require\(["']([^"']+)["']\);?/g, "import { $1 } from '$2';");
      code = code.replace(/const\s+(\w+)\s*=\s*require\(["']([^"']+)["']\);?/g, "import $1 from '$2';");
      code = code.replace(/module\.exports\s*=\s*([a-zA-Z0-9_$]+);?/g, "export default $1;");
      corrections.push("Autonomously converted CommonJS syntax to modern ESM imports");
      wasCorrected = true;
    }
  }

  // 2. Next.js 15 vs 14 React 19 Action Hook Alignment
  if (context?.framework === "nextjs" || context?.framework === "next") {
    const nextVersion = context?.dependencies?.["next"] || "";
    if (nextVersion.includes("15") || (context?.nodeVersion && context.nodeVersion >= 20)) {
      if (code.includes("useFormState")) {
        code = code.replace(/useFormState/g, "useActionState");
        corrections.push("Upgraded Next.js 14 useFormState hook to Next.js 15 / React 19 useActionState");
        wasCorrected = true;
      }
    }
  }

  // 3. Error Trace Self-Healing (Compiler / Runtime Diagnostic)
  if (errorTrace && typeof errorTrace === "string") {
    const trace = errorTrace.toLowerCase();

    // Missing crypto import
    if (trace.includes("crypto is not defined") || trace.includes("cannot find name 'crypto'")) {
      if (!code.includes("from \"crypto\"") && !code.includes("require(\"crypto\")")) {
        const importStatement = moduleSystem === "commonjs" 
          ? "const crypto = require('crypto');\n" 
          : "import crypto from 'crypto';\n";
        code = importStatement + code;
        corrections.push("Injected missing 'crypto' module import");
        wasCorrected = true;
      }
    }

    // Missing React import in JSX
    if (trace.includes("cannot find name 'react'") || trace.includes("'react' refers to a umd global")) {
      if (!code.includes("import React") && (code.includes("<") && code.includes("/>"))) {
        code = "import React from 'react';\n" + code;
        corrections.push("Injected missing React namespace import");
        wasCorrected = true;
      }
    }

    // Missing dotenv configuration
    if (trace.includes("process.env") && trace.includes("undefined")) {
      if (!code.includes("dotenv") && moduleSystem === "commonjs") {
        code = "require('dotenv').config();\n" + code;
        corrections.push("Injected dotenv.config() initialization");
        wasCorrected = true;
      }
    }

    // Python & Django: Missing models import
    if (trace.includes("name 'models' is not defined")) {
      if (!code.includes("from django.db import models") && !code.includes("import models")) {
        code = "from django.db import models\n" + code;
        corrections.push("Injected missing 'from django.db import models'");
        wasCorrected = true;
      }
    }

    // Python & Django: Missing DRF status import
    if (trace.includes("name 'status' is not defined") || trace.includes("cannot import name 'status'")) {
      if (!code.includes("from rest_framework import status")) {
        code = "from rest_framework import status\n" + code;
        corrections.push("Injected missing 'from rest_framework import status'");
        wasCorrected = true;
      }
    }

    // Python & Django: Missing stripe import
    if (trace.includes("name 'stripe' is not defined") || trace.includes("no module named 'stripe'")) {
      if (!code.includes("import stripe")) {
        code = "import stripe\n" + code;
        corrections.push("Injected missing 'import stripe' module");
        wasCorrected = true;
      }
    }

    // Python & Django: Missing celery shared_task import
    if (trace.includes("name 'shared_task' is not defined")) {
      if (!code.includes("from celery import shared_task")) {
        code = "from celery import shared_task\n" + code;
        corrections.push("Injected missing 'from celery import shared_task'");
        wasCorrected = true;
      }
    }

    // Python & Django: CSRF failure on webhooks
    if (trace.includes("csrf verification failed") || trace.includes("csrf cookie not set")) {
      if (!code.includes("csrf_exempt")) {
        code = "from django.views.decorators.csrf import csrf_exempt\n" + code;
        corrections.push("Injected Django @csrf_exempt decorator for webhook endpoints");
        wasCorrected = true;
      }
    }
  }

  // 4. Extract Suggested Environment Variables
  const suggestedEnv: Record<string, string> = {};
  for (const envKey of template.requiredEnv || []) {
    if (envKey === "SECRET_KEY") {
      suggestedEnv[envKey] = "django-insecure-" + crypto.randomBytes(24).toString("hex");
    } else if (envKey === "DATABASE_URL") {
      suggestedEnv[envKey] = "postgresql://user:password@localhost:5432/app_db";
    } else if (envKey === "CELERY_BROKER_URL") {
      suggestedEnv[envKey] = "redis://localhost:6379/0";
    } else if (envKey === "PAYMENTS_PROVIDER") {
      suggestedEnv[envKey] = "stripe"; // or "lemonsqueezy" / "polar"
    } else if (envKey === "STRIPE_API_KEY") {
      suggestedEnv[envKey] = "sk_test_51P...";
    } else if (envKey === "LEMONSQUEEZY_API_KEY") {
      suggestedEnv[envKey] = "eyJhbGciOi...";
    } else if (envKey === "POLAR_ACCESS_TOKEN") {
      suggestedEnv[envKey] = "polar_at_...";
    } else if (envKey.includes("SECRET") || envKey.includes("KEY")) {
      suggestedEnv[envKey] = "your_secure_random_key_here";
    } else if (envKey.includes("URL")) {
      suggestedEnv[envKey] = "https://yourdomain.com";
    } else {
      suggestedEnv[envKey] = "configured_value";
    }
  }

  // 5. Detect missing dependencies
  const installed = Object.keys(context?.dependencies || {});
  const missingDeps = (template.dependencies || [])
    .map(d => typeof d === "string" ? d : d.name)
    .filter(depName => !installed.includes(depName));

  return {
    code,
    wasCorrected,
    corrections,
    suggestedEnv,
    missingDependencies: missingDeps
  };
}
