import { GoldenTemplate, IntentDefinition, IntentRoutingResult, ProjectContext } from "./types.js";
import { scoreTemplateMatch } from "./scorer.js";

export const INTENT_REGISTRY: IntentDefinition[] = [
  {
    id: "payment.payhere",
    patterns: [
      "payhere payment add කරන්න",
      "payhere checkout integrate කරන්න",
      "payhere webhook එක setup කරන්න",
      "lkr payment gateway එකක් add කරන්න",
      "payhere checkout",
      "payhere payment",
      "payhere webhook",
      "payhere ipn",
      "payhere hash",
      "lkr payment gateway",
      "payhere integration",
    ],
    negativePatterns: ["stripe", "paypal", "crypto", "bitcoin"],
    templateId: "payhere-lkr-gateway",
    confidenceThreshold: 0.8,
  },
  {
    id: "identity.sl_nic",
    patterns: [
      "nic parser",
      "validate nic",
      "sri lanka nic",
      "sl nic",
      "national id card",
      "nic date of birth",
      "nic age calculation",
      "old nic new nic",
    ],
    negativePatterns: ["driving license", "passport"],
    templateId: "sl-nic-parser",
    confidenceThreshold: 0.8,
  },
  {
    id: "communication.sl_phone",
    patterns: [
      "validate sl phone",
      "sri lanka phone normalizer",
      "srilanka mobile validator",
      "sl landline validator",
      "e164 sl phone",
      "dialog mobitel phone regex",
    ],
    templateId: "sl-mobile-validator",
    confidenceThreshold: 0.8,
  },
  {
    id: "auth.jwt_rotation",
    patterns: [
      "jwt refresh token rotation",
      "session revocation",
      "jwt auth rotation",
      "bcrypt password hashing jwt",
      "access token refresh token",
      "token versioning logout all devices",
      "login api",
      "user authentication",
      "login auth",
    ],
    templateId: "jwt-auth-rotation",
    confidenceThreshold: 0.8,
  },
  {
    id: "auth.login_page",
    patterns: [
      "login page",
      "login form",
      "login page ekak",
      "login page hadanna",
      "login hadanna",
      "website login",
      "login page එකක් හදන්න",
      "login එකක් හදන්න",
      "create login page",
      "build login form",
      "user login page",
    ],
    templateId: "nextjs-app-auth",
    confidenceThreshold: 0.75,
  },
  {
    id: "security.rate_limiter",
    patterns: [
      "rate limiting brute force",
      "sliding window rate limiter",
      "csp security headers",
      "protect api against ddos",
      "cloudflare real ip rate limiter",
    ],
    templateId: "security-headers-ratelimit",
    confidenceThreshold: 0.8,
  },
  {
    id: "database.create_table",
    patterns: [
      "table add කරන්න",
      "orders table add කරන්න",
      "database table add කරන්න",
      "table add",
      "create table",
      "database migration schema",
      "prisma production schema",
    ],
    templateId: "prisma-production-schema",
    confidenceThreshold: 0.75,
  },
  {
    id: "database.users_schema",
    patterns: [
      "users table sql schema",
      "users table migration",
      "account lockout database schema",
      "token version users schema",
    ],
    templateId: "db-users-schema",
    confidenceThreshold: 0.8,
  },
  {
    id: "framework.nextjs_auth",
    patterns: [
      "nextjs app router auth",
      "nextjs edge auth middleware",
      "next 14 auth",
      "next 15 auth jose",
    ],
    templateId: "nextjs-app-auth",
    confidenceThreshold: 0.8,
  },
];

/**
 * 4-Tier Intent Router & Confidence Classifier:
 * - >= 0.90: DIRECT_EXECUTE (Deterministic 0-token instant local generation)
 * - >= 0.75: VALIDATE_AND_EXECUTE (Local template with schema & env validation)
 * - >= 0.50: ASK_CLARIFICATION (Ambiguous request: prompt user or small clarification)
 * - <  0.50: FALLBACK_LLM (Local deterministic engine cannot solve -> Route to LLM)
 */
export function classifyIntentAndRoute(
  query: string,
  templates: GoldenTemplate[],
  projectContext?: ProjectContext
): IntentRoutingResult {
  if (!query || typeof query !== "string") {
    return {
      template: null,
      intentId: null,
      confidence: 0,
      tier: "FALLBACK_LLM",
      reasons: ["Query is empty"],
      matchedKeywords: [],
    };
  }

  const qLower = query.trim().toLowerCase();

  // 1. Direct Slash Command override (/template sl-phone, etc.)
  if (/^\/(template|scaffold|golden)\s+/i.test(qLower)) {
    const scored = scoreTemplateMatch(qLower, templates, projectContext);
    if (scored.template) {
      return {
        template: scored.template,
        intentId: `slash.${scored.template.id}`,
        confidence: 0.99,
        tier: "DIRECT_EXECUTE",
        reasons: [`Direct slash command: ${query}`],
        matchedKeywords: scored.matchedKeywords,
      };
    }
  }

  // 2. High-Level Intent Pattern Matching
  let matchedIntent: IntentDefinition | null = null;
  let intentScore = 0;

  for (const intent of INTENT_REGISTRY) {
    // Check negative patterns (disqualifiers)
    if (intent.negativePatterns?.some((neg) => qLower.includes(neg.toLowerCase()))) {
      continue;
    }

    // Check exact patterns
    for (const pat of intent.patterns) {
      const patLower = pat.toLowerCase();
      if (qLower.includes(patLower)) {
        intentScore = Math.max(intentScore, 0.95);
        matchedIntent = intent;
        break;
      }
      // Partial token overlap check
      const patWords = patLower.split(/\s+/).filter((w) => w.length > 2);
      const matches = patWords.filter((w) => qLower.includes(w)).length;
      if (matches >= 2 && matches / patWords.length >= 0.6) {
        const partialScore = 0.8 + (matches / patWords.length) * 0.15;
        if (partialScore > intentScore) {
          intentScore = partialScore;
          matchedIntent = intent;
        }
      }
    }
  }

  // If intent matched, resolve the template
  if (matchedIntent && intentScore >= 0.75) {
    const targetTemplate = templates.find((t) => t.id === matchedIntent!.templateId);
    if (targetTemplate) {
      const tier = intentScore >= 0.9 ? "DIRECT_EXECUTE" : "VALIDATE_AND_EXECUTE";
      return {
        template: targetTemplate,
        intentId: matchedIntent.id,
        confidence: intentScore,
        tier,
        reasons: [`Matched intent pattern: '${matchedIntent.id}'`],
        matchedKeywords: [matchedIntent.id],
      };
    }
  }

  // 3. Fallback to Multi-Token Weighted Scoring
  const scored = scoreTemplateMatch(qLower, templates, projectContext);
  const normalizedConfidence = Math.min(1.0, scored.score / 60.0);

  if (normalizedConfidence >= 0.9 && scored.template) {
    return {
      template: scored.template,
      intentId: `scored.${scored.template.id}`,
      confidence: normalizedConfidence,
      tier: "DIRECT_EXECUTE",
      reasons: scored.reasons,
      matchedKeywords: scored.matchedKeywords,
    };
  }

  if (normalizedConfidence >= 0.75 && scored.template) {
    return {
      template: scored.template,
      intentId: `scored.${scored.template.id}`,
      confidence: normalizedConfidence,
      tier: "VALIDATE_AND_EXECUTE",
      reasons: scored.reasons,
      matchedKeywords: scored.matchedKeywords,
    };
  }

  if (normalizedConfidence >= 0.5 && scored.template) {
    return {
      template: scored.template,
      intentId: `scored.${scored.template.id}`,
      confidence: normalizedConfidence,
      tier: "ASK_CLARIFICATION",
      reasons: ["Medium confidence match; requires project confirmation"],
      matchedKeywords: scored.matchedKeywords,
    };
  }

  return {
    template: null,
    intentId: null,
    confidence: normalizedConfidence,
    tier: "FALLBACK_LLM",
    reasons: ["No local deterministic template exceeds confidence threshold (0.50)."],
    matchedKeywords: [],
  };
}
