import { SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";

const REVIEW_SYSTEM_PROMPT = `You are a Senior Principal Staff Software Engineer conducting an exhaustive, high-rigor Code Review.
Analyze the provided git diff or file changes against the following 4-pillar review checklist:

1. 🛡️ Security Vulnerabilities:
   - Check for SQL / command injection, XSS, unescaped user inputs.
   - Detect hardcoded secrets, API keys, credentials, or insecure cryptographic defaults.
   - Check authentication/authorization guards, timing attacks, and token validation.

2. 🐞 Correctness & Edge Cases:
   - Identify null/undefined pointer dereferences and missing error boundaries.
   - Check for race conditions, deadlock risks, unhandled Promise rejections, and async state tearing.
   - Look for off-by-one errors, boundary condition oversights, and resource handle leaks.

3. ⚡ Performance & Resource Efficiency:
   - Flag O(N^2) or higher algorithm complexity that could be optimized to O(N) or O(1).
   - Detect memory leaks, uncancelled timers/event listeners, and redundant re-renders.
   - Verify efficient database queries (missing indexes, N+1 query patterns).

4. 🧪 Test & Verification Coverage:
   - Highlight untested code paths, edge cases, and error fallback states.
   - Recommend targeted unit or integration tests.

Output Format:
- Start with an **Executive Assessment** (Pass / Caution / Needs Revision).
- For each finding, state:
  - **File & Location:** e.g. \`path/to/file.ts:line\`
  - **Severity:** [CRITICAL], [WARNING], or [SUGGESTION]
  - **Root Cause & Impact:** Clear explanation of why this is problematic.
  - **Actionable Fix:** Concrete, ready-to-apply code replacement.
- End with a concise summary of strengths and merge readiness.`;

export const ReviewCommand: SlashCommand = {
  name: "review",
  description:
    "Review uncommitted git diff or specified file against security and correctness standards",
  run: async function* ({ ide, llm, input, history, abortController }) {
    const rawTarget = (input || "").replace(/^\/review\s*/i, "").trim();

    let codeToReview = "";
    let reviewTargetDescription = "";

    // 1. If user targeted a specific file or path
    if (rawTarget.length > 0) {
      try {
        const workspaceDirs = await ide.getWorkspaceDirs();
        const baseDir =
          workspaceDirs && workspaceDirs.length > 0 ? workspaceDirs[0] : "";
        const targetPath =
          rawTarget.startsWith("file://") ||
          rawTarget.startsWith("/") ||
          rawTarget.includes(":")
            ? rawTarget
            : `${baseDir}/${rawTarget}`.replace(/\\/g, "/");

        const content = await ide.readFile(targetPath);
        if (content) {
          codeToReview = content;
          reviewTargetDescription = `File: \`${rawTarget}\``;
        }
      } catch {
        // Fallback to git diff if file couldn't be read
      }
    }

    // 2. Default: fetch working git diff (staged + unstaged)
    if (!codeToReview) {
      try {
        const diffChunks = await ide.getDiff(true);
        if (diffChunks && diffChunks.length > 0) {
          codeToReview = diffChunks.join("\n");
          reviewTargetDescription =
            "Working Git Changes (Staged & Unstaged Diff)";
        }
      } catch {
        // ide.getDiff failed
      }
    }

    // 3. Fallback: if no git diff and no file, check last assistant or user snippet
    if (!codeToReview) {
      const lastMessage = history
        ?.slice()
        .reverse()
        .find(
          (m) =>
            m.content &&
            (typeof m.content === "string" ? m.content.length > 20 : true),
        );
      if (lastMessage) {
        codeToReview =
          typeof lastMessage.content === "string" ? lastMessage.content : "";
        reviewTargetDescription = "Recent Conversation Snippet";
      }
    }

    if (!codeToReview || codeToReview.trim().length === 0) {
      yield "🔍 **No code changes detected to review.**\n\n" +
        "Make changes in your workspace, stage changes with git, or specify a file path to review:\n" +
        "- `/review` — Reviews all working git changes.\n" +
        "- `/review src/auth/token.ts` — Reviews a specific file.";
      return;
    }

    yield `🔬 **VynorAI Deep Code Review** analyzing **${reviewTargetDescription}**...\n\n`;

    const userPrompt = `${REVIEW_SYSTEM_PROMPT}\n\nTarget Code / Git Diff to Review:\n\`\`\`diff\n${codeToReview.slice(0, 15000)}\n\`\`\``;

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: userPrompt }],
      abortController.signal,
    )) {
      yield renderChatMessage(chunk);
    }
  },
};

export default ReviewCommand;
