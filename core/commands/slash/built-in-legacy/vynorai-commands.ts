/**
 * VynorAI Slash Commands — Full Suite
 *
 * These commands are available in the VynorAI chat via "/" prefix.
 * Each command:
 *  1. Collects relevant context (selected code, git diff, open file)
 *  2. Builds a focused XML-wrapped prompt
 *  3. Streams the AI response back to the user via the VynorAI backend
 *
 * Registered commands:
 *  /fix      — Debug and fix code / errors
 *  /explain  — Step-by-step explanation of selected code
 *  /test     — Generate comprehensive unit tests
 *  /refactor — Refactor for clarity, performance, best practices
 *  /docs     — Generate JSDoc / documentation comments
 *  /review   — Professional code review with actionable feedback
 *  /security — Security audit of selected code
 *  /optimize — Performance optimization suggestions
 *  /scaffold — Scaffold a new feature/component from description
 */

import { SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";

// ─── Helper: stream LLM response ─────────────────────────────────────────────
async function* streamLLM(
  llm: any,
  prompt: string,
  abortController: AbortController
): AsyncGenerator<string> {
  for await (const chunk of llm.streamChat(
    [{ role: "user", content: prompt }],
    abortController.signal,
  )) {
    yield renderChatMessage(chunk);
  }
}

// ─── /fix — Debug & Fix ───────────────────────────────────────────────────────
export const FixCommand: SlashCommand = {
  name: "fix",
  description: "Debug and auto-fix the error or selected code",
  run: async function* ({ ide, llm, input, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile = await (ide as any).getCurrentFile?.() || { path: "", contents: "" };
    const errorText     = (input || "").replace("/fix", "").trim();

    const prompt = `<vynorai_task type="fix">
  <instruction>
    Debug and fix the following code/error. Identify the root cause first,
    then provide the exact fix using Search/Replace format.
    Make only the minimal change needed. Do not refactor unrelated code.
  </instruction>
  ${errorText ? `<error_message>\n${errorText}\n</error_message>` : ""}
  ${selectedCode ? `<selected_code>\n${selectedCode}\n</selected_code>` : ""}
  ${currentFile.contents ? `<current_file path="${currentFile.path}">\n${currentFile.contents.slice(0, 8000)}\n</current_file>` : ""}
  <output_format>
    1. Root cause (1-2 sentences)
    2. Fix using Search/Replace format or edit_file tool
    3. Explanation of why this fixes the issue
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /explain — Code Explanation ─────────────────────────────────────────────
export const ExplainCommand: SlashCommand = {
  name: "explain",
  description: "Explain selected code step by step",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile  = await (ide as any).getCurrentFile?.() || { path: "" };

    if (!selectedCode) {
      yield "⚠️ Select some code first, then run **/explain**.";
      return;
    }

    const prompt = `<vynorai_task type="explain">
  <instruction>
    Explain the following code from "${currentFile.path}" step by step.
    Be technical but clear. Cover: what it does, how it works, why it's
    written this way, and any important edge cases or gotchas.
  </instruction>
  <code>\n${selectedCode}\n</code>
  <output_format>
    ## What it does
    [1-2 sentence summary]

    ## How it works (step by step)
    [numbered breakdown]

    ## Key details
    [any important patterns, performance notes, or gotchas]
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /test — Generate Unit Tests ─────────────────────────────────────────────
export const TestCommand: SlashCommand = {
  name: "test",
  description: "Generate comprehensive unit tests for selected code",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile  = await (ide as any).getCurrentFile?.() || { path: "", contents: "" };

    if (!selectedCode) {
      yield "⚠️ Select the function/class to test, then run **/test**.";
      return;
    }

    const prompt = `<vynorai_task type="test">
  <instruction>
    Write comprehensive unit tests for the code below from "${currentFile.path}".
    Cover: happy paths, edge cases, error conditions, and boundary values.
    Use the same testing framework already present in the project if detectable,
    otherwise default to Jest/Vitest for JS/TS, pytest for Python, JUnit for Java.
    Tests must be runnable without modification.
  </instruction>
  <code_to_test>\n${selectedCode}\n</code_to_test>
  <output_format>
    Provide complete, runnable test file with:
    - Imports/setup
    - describe/it blocks with descriptive names
    - At minimum: happy path, null/undefined inputs, error conditions
    - No placeholder "TODO" tests
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /refactor — Refactor Code ───────────────────────────────────────────────
export const RefactorCommand: SlashCommand = {
  name: "refactor",
  description: "Refactor selected code for clarity and performance",
  run: async function* ({ ide, llm, input, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const focus = (input || "").replace("/refactor", "").trim();

    if (!selectedCode) {
      yield "⚠️ Select the code to refactor, then run **/refactor**.";
      return;
    }

    const prompt = `<vynorai_task type="refactor">
  <instruction>
    Refactor the following code. ${focus ? `Focus on: ${focus}.` : ""}
    Goals: improve readability, reduce complexity, follow SOLID principles,
    eliminate code smells. Preserve exact behaviour — this is not a rewrite.
    Show only the refactored version with a brief explanation of each change.
  </instruction>
  <original_code>\n${selectedCode}\n</original_code>
  <output_format>
    ## Refactored Code
    [complete refactored version]

    ## Changes Made
    [bullet list: what changed and why]
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /docs — Generate Documentation ──────────────────────────────────────────
export const DocsCommand: SlashCommand = {
  name: "docs",
  description: "Generate JSDoc/documentation for selected code",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile  = await (ide as any).getCurrentFile?.() || { path: "" };

    if (!selectedCode) {
      yield "⚠️ Select a function or class, then run **/docs**.";
      return;
    }

    // Detect language from file extension
    const ext = currentFile.path.split(".").pop() || "ts";
    const docStyle = ext === "py" ? "Google-style docstring" :
                     ["java", "kt"].includes(ext) ? "Javadoc" : "JSDoc";

    const prompt = `<vynorai_task type="docs">
  <instruction>
    Write ${docStyle} documentation for the following code from "${currentFile.path}".
    Include: description, all @param tags with types and descriptions,
    @returns tag, @throws if applicable, and a usage @example.
    Only output the documented version of the code — do not explain outside the docs.
  </instruction>
  <code>\n${selectedCode}\n</code>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /review — Code Review ────────────────────────────────────────────────────
export const ReviewCommand: SlashCommand = {
  name: "review",
  description: "Professional code review with actionable feedback",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const diff = await ide.getDiff?.(false) || [];

    const codeToReview = selectedCode || diff.join("\n");
    if (!codeToReview) {
      yield "⚠️ Select code OR make some git changes, then run **/review**.";
      return;
    }

    const prompt = `<vynorai_task type="review">
  <instruction>
    Perform a thorough code review of the following code.
    Review criteria: correctness, security, performance, readability,
    error handling, edge cases, and best practices.
    Be specific — reference exact line content, not line numbers.
    Provide actionable fixes, not just criticism.
  </instruction>
  <code>\n${codeToReview.slice(0, 10000)}\n</code>
  <output_format>
    ## 🔴 Critical Issues (must fix)
    ## 🟡 Warnings (should fix)
    ## 🟢 Suggestions (nice to have)
    ## ✅ What's done well
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /security — Security Audit ──────────────────────────────────────────────
export const SecurityCommand: SlashCommand = {
  name: "security",
  description: "Security audit — find vulnerabilities in selected code",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile  = await (ide as any).getCurrentFile?.() || { path: "", contents: "" };

    const code = selectedCode || currentFile.contents?.slice(0, 10000) || "";
    if (!code) {
      yield "⚠️ Select code or open a file, then run **/security**.";
      return;
    }

    const prompt = `<vynorai_task type="security_audit">
  <instruction>
    Perform a security audit on the following code.
    Check for: SQL injection, XSS, CSRF, insecure deserialization, hardcoded secrets,
    improper authentication, missing input validation, path traversal,
    race conditions, memory safety issues, and OWASP Top 10 vulnerabilities.
    For each issue found, provide the exact vulnerable code and a secure fix.
  </instruction>
  <code path="${currentFile.path}">\n${code}\n</code>
  <output_format>
    ## Security Findings

    ### [SEVERITY: CRITICAL/HIGH/MEDIUM/LOW] Issue Name
    **Vulnerability**: description
    **Vulnerable code**: \`...\`
    **Fix**: \`...\`
    **Why**: explanation

    ## Overall Security Score: X/10
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /optimize — Performance Optimization ────────────────────────────────────
export const OptimizeCommand: SlashCommand = {
  name: "optimize",
  description: "Identify and fix performance bottlenecks",
  run: async function* ({ ide, llm, abortController }) {
    const selectedCode = await (ide as any).getSelectedText?.() || "";
    const currentFile  = await (ide as any).getCurrentFile?.() || { path: "" };

    if (!selectedCode) {
      yield "⚠️ Select the code to optimize, then run **/optimize**.";
      return;
    }

    const prompt = `<vynorai_task type="optimize">
  <instruction>
    Analyze the following code from "${currentFile.path}" for performance issues.
    Consider: algorithmic complexity (Big-O), unnecessary iterations, memory allocation,
    database N+1 queries, blocking I/O, caching opportunities, and bundle size impact.
    Provide the optimized version with benchmarks or complexity analysis.
  </instruction>
  <code>\n${selectedCode}\n</code>
  <output_format>
    ## Performance Analysis
    Current complexity: O(?)
    Bottlenecks identified: [list]

    ## Optimized Code
    [improved version]

    ## Improvements
    - [what changed and expected speedup]
    New complexity: O(?)
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /scaffold — Scaffold New Feature ────────────────────────────────────────
export const ScaffoldCommand: SlashCommand = {
  name: "scaffold",
  description: "Scaffold a new component/feature from description",
  run: async function* ({ ide, llm, input, abortController }) {
    const description = (input || "").replace("/scaffold", "").trim();
    const currentFile = await (ide as any).getCurrentFile?.() || { path: "" };

    if (!description) {
      yield "⚠️ Describe what to scaffold: **/scaffold** a React auth form with email and password";
      return;
    }

    // Try to detect framework from open file
    const ext = currentFile.path.split(".").pop() || "ts";
    const lang = ["tsx", "jsx"].includes(ext) ? "React/TypeScript" :
                 ext === "vue" ? "Vue 3" :
                 ext === "svelte" ? "Svelte" :
                 ext === "py" ? "Python" : "TypeScript";

    const prompt = `<vynorai_task type="scaffold">
  <instruction>
    Scaffold the following in ${lang}: "${description}"
    
    Requirements:
    - Production-ready, not a placeholder
    - Follow ${lang} best practices and conventions
    - Include error handling and loading states where applicable
    - TypeScript types/interfaces where relevant
    - Brief inline comments for non-obvious logic
    - Tell me what files to create and where
  </instruction>
  <output_format>
    For each file:
    ## \`path/to/file.ext\`
    \`\`\`${ext}
    [complete file contents]
    \`\`\`

    ## Setup Instructions
    [any dependencies to install, config changes needed]
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /commit — Generate Conventional Git Commit ──────────────────────────────
export const CommitCommand: SlashCommand = {
  name: "commit",
  description: "Analyze git diff and generate an accurate Conventional Commit message",
  run: async function* ({ ide, llm, abortController }) {
    yield "🔍 Reading git diff...\n\n";
    let diffs: string[] = [];
    try {
      diffs = await (ide as any).getDiff?.(true) || [];
    } catch {
      diffs = [];
    }

    const diffText = diffs.join("\n").slice(0, 12000);
    if (!diffText.trim()) {
      yield "ℹ️ No unstaged or staged git changes detected in this workspace.";
      return;
    }

    const prompt = `<vynorai_task type="commit">
  <instruction>
    Analyze the following git diff and generate a high quality Conventional Commit message.
    Follow conventional commit format: <type>(<scope>): <short summary>
    Types: feat, fix, refactor, docs, style, test, chore, perf.
  </instruction>
  <git_diff>
${diffText}
  </git_diff>
  <output_format>
    ### Suggested Commit:
    \`\`\`git
    <type>(<scope>): <concise title under 72 chars>
    \`\`\`

    **Detailed Description:**
    - [Summary of main change 1]
    - [Summary of main change 2]

    **Terminal Command:**
    \`\`\`bash
    git commit -m "<type>(<scope>): <concise title>"
    \`\`\`
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /errors — Auto-Inspect & Fix IDE Diagnostic Errors ────────────────────────
export const ErrorsCommand: SlashCommand = {
  name: "errors",
  description: "Inspect compiler/linter diagnostics in the current file and auto-fix them",
  run: async function* ({ ide, llm, abortController }) {
    yield "🩺 Inspecting IDE diagnostics & problems...\n\n";
    let problems: any[] = [];
    try {
      problems = await (ide as any).getProblems?.() || [];
    } catch {
      problems = [];
    }

    const currentFile = await (ide as any).getCurrentFile?.() || { path: "", contents: "" };
    const relevantProblems = problems.filter((p: any) =>
      !currentFile.path || (p.filepath && p.filepath.endsWith(currentFile.path.split(/[/\\]/).pop() || ""))
    ).slice(0, 10);

    const problemSummary = (relevantProblems.length > 0 ? relevantProblems : problems.slice(0, 8))
      .map((p: any) => `- [Line ${p.range?.start?.line ?? "?"}] ${p.message} (${p.source || "linter"})`)
      .join("\n");

    if (!problemSummary.trim()) {
      yield "✅ No active compiler, TypeScript, or linter problems detected in this file!";
      return;
    }

    const prompt = `<vynorai_task type="diagnostics_fix">
  <instruction>
    Fix the following IDE compiler/linter diagnostics. Provide minimal surgical fixes.
  </instruction>
  <detected_problems>
${problemSummary}
  </detected_problems>
  ${currentFile.contents ? `<current_file path="${currentFile.path}">\n${currentFile.contents.slice(0, 8000)}\n</current_file>` : ""}
  <output_format>
    For each problem:
    1. Problem diagnosis (why it occurs)
    2. Exact fix code block
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── /architect — Multi-File Coordinated Fullstack Planning ───────────────────
export const ArchitectCommand: SlashCommand = {
  name: "architect",
  description: "Plan multi-file coordinated architecture (DB, Backend, Frontend, Types)",
  run: async function* ({ ide, llm, input, abortController }) {
    const feature = (input || "").replace("/architect", "").trim();
    if (!feature) {
      yield "⚠️ Specify the feature to architect: **/architect** Implement Stripe webhook with subscription upgrade";
      return;
    }

    const prompt = `<vynorai_task type="architect">
  <instruction>
    Architect a complete, production-grade, multi-file implementation plan for:
    "${feature}"
    
    Coordinate changes across all relevant layers:
    1. Data model / Schema / DB migration
    2. Backend routes, controllers, middleware
    3. Shared TypeScript types/contracts
    4. Frontend UI components & state
    5. Unit & integration test plan
  </instruction>
  <output_format>
    # Architecture Blueprint: ${feature}

    ## 1. Affected Files & Responsibilities
    | File Path | Layer | Purpose |
    |---|---|---|
    | ... | ... | ... |

    ## 2. Coordinated Implementation Steps
    ### Step 1: [Layer]
    [Code snippet & instructions]

    ### Step 2: [Layer]
    [Code snippet & instructions]

    ## 3. Verification & Safety Checklist
    - [ ] Compilation / Typecheck
    - [ ] Security & Validation
    - [ ] Edge cases
  </output_format>
</vynorai_task>`;

    yield* streamLLM(llm, prompt, abortController);
  },
};

// ─── Export All VynorAI Slash Commands ────────────────────────────────────────
export const VYNORAI_SLASH_COMMANDS: SlashCommand[] = [
  FixCommand,
  ExplainCommand,
  TestCommand,
  RefactorCommand,
  DocsCommand,
  ReviewCommand,
  SecurityCommand,
  OptimizeCommand,
  ScaffoldCommand,
  CommitCommand,
  ErrorsCommand,
  ArchitectCommand,
];

