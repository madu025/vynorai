/**
 * VynorAI Terminal Error & Stack Trace Quick-Fix Engine
 * ----------------------------------------------------
 * High-precision analyzer that takes compiler errors, unit test failures,
 * or runtime stack traces, isolates the root cause, and generates an instant
 * search/replace surgical patch.
 */

import { Response } from "express";
import { AuthenticatedUser } from "./aiProxy.js";
import { dispatchToProvider } from "./providerRouter.js";
import { sanitizeText } from "./secretSanitizer.js";
import { getPlan } from "../config.js";

export interface QuickFixRequest {
  errorLog: string;         // Terminal output / compiler error / stack trace
  codeContext?: string;     // Active file code around the error
  filePath?: string;        // Path to the failing file
  language?: string;        // Language (e.g. typescript, python)
  model?: string;
}

export async function handleQuickFix(
  user: AuthenticatedUser,
  body: QuickFixRequest,
  res: Response
) {
  const plan = getPlan(user.subscriptionPlan || "free");
  const model = body.model || (user.subscriptionPlan === "pro" || user.subscriptionPlan === "ultra" 
    ? "deepseek/deepseek-r1" 
    : "deepseek/deepseek-chat-v3-0324");

  const cleanError = sanitizeText(body.errorLog || "").text;
  const cleanContext = sanitizeText(body.codeContext || "").text;

  const prompt = `
You are the VynorAI Code Repair Engine.
Analyze the following terminal error and active code context.
Diagnose the exact root cause and generate a surgical fix.

### TERMINAL ERROR / STACK TRACE:
\`\`\`
${cleanError}
\`\`\`

${cleanContext ? `### ACTIVE CODE CONTEXT (${body.filePath || "File"}):
\`\`\`${body.language || ""}
${cleanContext}
\`\`\`` : ""}

### INSTRUCTIONS:
1. Explain the root cause in 1-2 concise bullet points.
2. Provide the exact surgical patch using SEARCH/REPLACE format:
<<<<<<< SEARCH
[exact existing lines to be replaced]
=======
[fixed replacement lines]
>>>>>>>
3. If no code was provided, provide the exact corrected code block with filename.
`;

  const payload = {
    model,
    messages: [
      { role: "system", content: "You are an elite automated debugger that fixes terminal compiler and runtime errors." },
      { role: "user", content: prompt },
    ],
    temperature: 0.1,
    stream: true,
  };

  res.setHeader("X-VynorAI-Engine", "QuickFix-Repair");
  await dispatchToProvider(payload, res);
}
