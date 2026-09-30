import { GoldenTemplate, IntentMatchResult } from "./types.js";

/**
 * Multi-Token Weighted Scoring Engine for Golden Templates.
 * Replaces naive first-match regex with a probabilistic intent classifier.
 *
 * Prevents generic words like "payment" from blindly triggering the wrong template
 * when specific integrations (like PayHere, Stripe, or LKR Gateway) are requested.
 */
export function scoreTemplateMatch(
  query: string,
  templates: GoldenTemplate[],
  projectContext?: { framework?: string; language?: string }
): IntentMatchResult {
  if (!query || typeof query !== "string") {
    return { template: null, score: 0, confidence: "NONE", matchedKeywords: [], reasons: [] };
  }

  const qClean = query.trim().toLowerCase();
  const qTokens = qClean
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

  // 1. Check for direct slash command (e.g. /template sl-phone, /scaffold payhere)
  const slashMatch = qClean.match(/^\/(template|scaffold|golden)\s+([a-zA-Z0-9_-]+)/i);
  if (slashMatch) {
    const rawTarget = slashMatch[2].toLowerCase();
    const target = rawTarget.replace(/[-_]/g, "");
    const targetWithSpaces = rawTarget.replace(/[-_]/g, " ");

    const found = templates.find((t) => {
      const cleanId = t.id.toLowerCase().replace(/[-_]/g, "");
      if (cleanId === target || cleanId.includes(target) || target.includes(cleanId)) return true;
      return t.keywords.some((kw) => {
        const cleanKw = kw.toLowerCase().replace(/[-_\s]/g, "");
        return cleanKw === target || cleanKw.includes(target) || target.includes(cleanKw) || kw.toLowerCase().includes(targetWithSpaces);
      });
    });

    if (found) {
      return {
        template: found,
        score: 100,
        confidence: "HIGH",
        matchedKeywords: [slashMatch[0]],
        reasons: [`Direct slash command: '${slashMatch[0]}'`]
      };
    }
  }

  let bestTemplate: GoldenTemplate | null = null;
  let bestScore = 0;
  let bestMatchedKeywords: string[] = [];
  let bestReasons: string[] = [];

  for (const t of templates) {
    let score = 0;
    const matchedKws: string[] = [];
    const reasons: string[] = [];

    const templateIdClean = t.id.toLowerCase();
    const idTokens = templateIdClean.split(/[-_]/);

    // 2. Direct ID / Slug Match (+50 points)
    if (qClean.includes(templateIdClean)) {
      score += 50;
      reasons.push(`Direct ID match on '${t.id}' (+50)`);
    } else {
      let idMatches = 0;
      for (const idTok of idTokens) {
        if (qTokens.includes(idTok)) idMatches++;
      }
      if (idMatches >= 2) {
        score += idMatches * 15;
        reasons.push(`${idMatches} ID token matches (${idTokens.join(", ")})`);
      } else if (idMatches === 1 && idTokens[0].length > 3) {
        score += 15;
        reasons.push(`Primary ID token match '${idTokens[0]}' (+15)`);
      }
    }

    // 3. Exact Keyword Matching (+25 points for multi-word, +15 for single word)
    for (const kw of t.keywords) {
      const kwLower = kw.toLowerCase();
      if (qClean.includes(kwLower)) {
        const isMultiWord = kwLower.includes(" ");
        const points = isMultiWord ? 25 : 15;
        score += points;
        matchedKws.push(kw);
        reasons.push(`Keyword match: '${kw}' (+${points})`);
      }
    }

    // 4. Config Parameter Mention (+15 points each)
    // If user prompt mentions "merchant id" or "merchantId" for payhere, or "token" for auth
    if (t.configSchema) {
      for (const [paramKey, rule] of Object.entries(t.configSchema)) {
        const paramLower = paramKey.toLowerCase();
        const paramWords = paramKey.replace(/([A-Z])/g, " $1").toLowerCase();
        if (qClean.includes(paramLower) || qClean.includes(paramWords)) {
          score += 15;
          reasons.push(`Prompt mentions config parameter '${paramKey}' (+15)`);
        }
      }
    }

    // 5. Title Token Match (+8 points per significant word)
    const titleTokens = t.title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((tok) => tok.length > 3);

    for (const tTok of titleTokens) {
      if (qTokens.includes(tTok) && !idTokens.includes(tTok)) {
        score += 8;
      }
    }

    // 6. Project Context Affinity (+15 points)
    if (projectContext?.framework && t.frameworks) {
      const ctxFw = projectContext.framework.toLowerCase();
      if (t.frameworks.some((f) => f.toLowerCase() === ctxFw)) {
        score += 15;
        reasons.push(`Framework affinity with '${projectContext.framework}' (+15)`);
      }
    }
    if (projectContext?.language && t.languages) {
      const ctxLang = projectContext.language.toLowerCase();
      if (t.languages.some((l) => l.toLowerCase() === ctxLang)) {
        score += 10;
        reasons.push(`Language affinity with '${projectContext.language}' (+10)`);
      }
    }

    // 7. Category Conflict Penalty
    if (qTokens.includes("python") && !t.languages.includes("python") && t.languages.includes("typescript")) {
      score -= 20;
    }

    if (score > bestScore) {
      bestScore = score;
      bestTemplate = t;
      bestMatchedKeywords = matchedKws;
      bestReasons = reasons;
    }
  }

  // Determine Confidence Thresholds
  let confidence: IntentMatchResult["confidence"] = "NONE";
  if (bestScore >= 35) {
    confidence = "HIGH";
  } else if (bestScore >= 20) {
    confidence = "MEDIUM";
  } else if (bestScore >= 10) {
    confidence = "LOW";
  }

  // Only return template if confidence is MEDIUM or HIGH
  const finalTemplate = bestScore >= 20 ? bestTemplate : null;

  return {
    template: finalTemplate,
    score: bestScore,
    confidence,
    matchedKeywords: bestMatchedKeywords,
    reasons: bestReasons,
  };
}
