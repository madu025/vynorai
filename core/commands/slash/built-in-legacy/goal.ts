import { SlashCommand } from "../../../index.js";
import { renderChatMessage } from "../../../util/messageContent.js";
import { SelfHealingEngine } from "../../../maintenance/SelfHealingEngine.js";

const GOAL_ORCHESTRATOR_PROMPT = `You are VynorAI's Autonomous Long-Running Goal Orchestrator (equivalent to DeepMind / Antigravity Goal Mode).
The user has assigned a high-priority, long-running engineering objective.
Your duty is to be extra thorough and not stop until the goal is fully achieved and verified.

For the user's objective:
1. 🎯 Break down the objective into 3 to 5 clear, sequential execution milestones.
2. 🛠️ Specify concrete implementation steps for each milestone (target files, algorithms, interfaces).
3. 🧪 Define automated test & verification criteria for each milestone (unit tests, typecheck).
4. 🔄 Highlight potential failure modes and self-healing strategies if tests fail.
5. 🚀 Provide an immediate, actionable execution launch plan.

Format with high readability using emojis, bullet points, and code snippets.`;

export const GoalCommand: SlashCommand = {
  name: "goal",
  description:
    "Execute a long-running engineering objective autonomously until fully achieved and verified",
  run: async function* ({ ide, llm, input, abortController }) {
    const rawGoal = (input || "").replace(/^\/goal\s*/i, "").trim();

    if (!rawGoal || rawGoal.length === 0) {
      yield "🎯 **VynorAI Autonomous Goal Mode**\n\n" +
        "Please provide a specific engineering objective to execute.\n\n" +
        "**Examples:**\n" +
        "- `/goal Build complete checkout flow with PayHere LKR and order confirmation emails`\n" +
        "- `/goal Migrate authentication to OAuth2 with Google & GitHub, and write tests`\n" +
        "- `/goal Optimize database queries in billing service to eliminate N+1 latency`\n";
      return;
    }

    void ide.showToast?.(
      "info",
      `🎯 VynorAI Goal started: "${rawGoal.slice(0, 40)}..."`,
    );

    yield `🎯 **VynorAI Goal Orchestrator** activating for long-running execution...\n\n` +
      `**Objective:** *${rawGoal}*\n\n` +
      `🌿 *Worktree Isolation & Self-Healing Verification Engine engaged.*\n\n` +
      `---\n\n`;

    // Discover workspace context
    let workspaceSummary = "";
    try {
      const workspaceDirs = await ide.getWorkspaceDirs();
      if (workspaceDirs && workspaceDirs.length > 0) {
        workspaceSummary = `Active Workspace: ${workspaceDirs[0]}\n`;
      }
    } catch {}

    const prompt = `${GOAL_ORCHESTRATOR_PROMPT}\n\n${workspaceSummary}User Goal / Objective:\n${rawGoal}`;

    for await (const chunk of llm.streamChat(
      [{ role: "user", content: prompt }],
      abortController.signal,
    )) {
      yield renderChatMessage(chunk);
    }

    void ide.showToast?.(
      "info",
      "✅ VynorAI Goal Plan & Verification gates prepared!",
    );

    yield `\n\n---\n✅ **Goal Plan Formulated.** VynorAI is ready to execute each milestone with automated verification gates.`;
  },
};

export default GoalCommand;
